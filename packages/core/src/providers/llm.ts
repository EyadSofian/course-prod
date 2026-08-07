import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { createLogger } from "../logger.js";
import { parseLessonJson, type LessonJson } from "../schema/lesson.js";
import { TerminalError, RetryableError } from "../stages.js";
import type { Settings } from "../settings.js";
import { buildLessonJsonSchema } from "./llm-schema.js";

const log = createLogger("llm");
const here = dirname(fileURLToPath(import.meta.url));

export interface SummarizeInput {
  lessonId: string;
  titleAr: string;
  market: "EG" | "KSA" | "GULF";
  sourceText: string;
  /** Producer ticked "material is dense" — forces the stronger model (§6.2). */
  dense: boolean;
  settings: Settings;
}

export interface SummarizeResult {
  lesson: LessonJson;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  /** True when the first response failed validation and the repair succeeded. */
  repaired: boolean;
  /** Kept for stage_runs.log so a bad generation can be inspected afterwards. */
  rawFirstResponse: string;
}

/** Base template ships in git (§6.2); a UI override in settings wins when set. */
export async function loadPromptTemplate(settings: Settings): Promise<string> {
  if (settings.summarizePromptOverride.trim()) return settings.summarizePromptOverride;
  // dist/providers -> package root -> prompts/
  return readFile(resolve(here, "../../prompts/summarize.ar.md"), "utf8");
}

export function renderPrompt(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

function pickModel(input: SummarizeInput): string {
  const { settings, sourceText, dense } = input;
  const useDense = dense || sourceText.length > settings.denseCharThreshold;
  return useDense ? settings.summarizeModelDense : settings.summarizeModel;
}

function costCents(settings: Settings, model: string, inTok: number, outTok: number): number {
  const rate = settings.llmRates[model];
  if (!rate) {
    log.warn("no rate configured for model, using fallback", { model });
  }
  const { inputPerMTok, outputPerMTok } = rate ?? settings.llmFallbackRate;
  const usd = (inTok / 1_000_000) * inputPerMTok + (outTok / 1_000_000) * outputPerMTok;
  return Math.round(usd * 100);
}

/**
 * §6.2. JSON only, validated with zod, with exactly one repair attempt that
 * feeds the validation error back before the stage fails.
 *
 * Strict structured outputs make a malformed *shape* nearly impossible, but
 * they cannot enforce the §4 invariant (narration must correspond 1:1 with
 * slides) because that is a cross-field constraint. That is precisely what the
 * repair round-trip is for.
 */
export async function summarize(input: SummarizeInput): Promise<SummarizeResult> {
  const { settings } = input;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TerminalError(
      "مفتاح OpenAI غير مضبوط. أضف OPENAI_API_KEY إلى إعدادات الخدمة.",
      "AUTH_FAILURE",
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
    maxRetries: 0, // retries are the stage runner's decision (§9)
    timeout: 10 * 60 * 1000,
  });

  const model = pickModel(input);
  const template = await loadPromptTemplate(settings);
  const schema = buildLessonJsonSchema(settings.slideCap);

  const prompt = renderPrompt(template, {
    slide_cap: settings.slideCap,
    duration: settings.durationTargetMin,
    quiz_count: settings.quizCount,
    market: input.market,
    title: input.titleAr,
    lesson_id: input.lessonId,
    schema: JSON.stringify(schema, null, 2),
    source_text: input.sourceText,
  });

  let totalIn = 0;
  let totalOut = 0;
  let rawFirst = "";

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: string;
    try {
      const res = await client.chat.completions.create({
        model,
        messages,
        max_completion_tokens: settings.summarizeMaxTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name: "course_lesson", strict: true, schema },
        },
      });

      totalIn += res.usage?.prompt_tokens ?? 0;
      totalOut += res.usage?.completion_tokens ?? 0;
      raw = res.choices[0]?.message?.content ?? "";

      if (res.choices[0]?.finish_reason === "length") {
        throw new TerminalError(
          `تجاوز الرد الحد الأقصى للرموز (${settings.summarizeMaxTokens}). ` +
            `قلّل عدد الشرائح أو ارفع الحد من الإعدادات.`,
          "LIMIT_EXCEEDED",
        );
      }
    } catch (e) {
      if (e instanceof TerminalError) throw e;
      throw classifyOpenAiError(e);
    }

    if (attempt === 1) rawFirst = raw;

    const parsed = parseLessonJson(raw);
    if (parsed.ok && parsed.lesson) {
      return {
        lesson: parsed.lesson,
        model,
        inputTokens: totalIn,
        outputTokens: totalOut,
        costCents: costCents(settings, model, totalIn, totalOut),
        repaired: attempt > 1,
        rawFirstResponse: rawFirst,
      };
    }

    log.warn("lesson json failed validation", {
      lesson_id: input.lessonId,
      attempt,
      issues: parsed.errorText,
    });

    if (attempt === 2) {
      // §6.2: fail the stage with the raw output preserved for stage_runs.log.
      throw new TerminalError(
        "فشلت هيكلة الدرس. ردّ النموذج لا يطابق المخطط، وحاولنا إصلاحه مرة واحدة دون نجاح.",
        "SCHEMA_VALIDATION",
        { issues: parsed.errorText, raw: raw.slice(0, 20_000) },
      );
    }

    // One repair attempt, with the validation error fed back verbatim.
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        `المخرَج السابق لم يجتز التحقق. الأخطاء:\n${parsed.errorText}\n\n` +
        `أعد إخراج الدرس كاملاً بصيغة JSON فقط بعد إصلاح هذه الأخطاء. ` +
        `تذكّر: لكل شريحة في slides يجب أن يوجد عنصر واحد في narration بنفس الـ id، ` +
        `وعدد العنصرين متساوٍ.`,
    });
  }

  /* c8 ignore next */
  throw new TerminalError("unreachable", "SCHEMA_VALIDATION");
}

/** §9: 429 and 5xx are retryable; auth and request errors are terminal. */
function classifyOpenAiError(e: unknown): Error {
  const status = (e as { status?: number }).status;
  const message = (e as { message?: string }).message ?? String(e);

  if (status === 401 || status === 403) {
    return new TerminalError(
      "مفتاح OpenAI مرفوض. تحقّق من OPENAI_API_KEY.",
      "AUTH_FAILURE",
    );
  }
  if (status === 400) {
    return new TerminalError(`طلب غير صالح إلى OpenAI: ${message}`, "SCHEMA_VALIDATION");
  }
  if (status === 429) {
    return new RetryableError("خدمة OpenAI مزدحمة.", 30_000);
  }
  if (status && status >= 500) {
    return new RetryableError(`خطأ من خادم OpenAI (${status}).`);
  }
  return new RetryableError(`تعذّر الوصول إلى OpenAI: ${message}`);
}
