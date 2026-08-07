import { eq } from "drizzle-orm";
import { assertBudget } from "@course-prod/core/costs";
import { getDb, courses, lessons } from "@course-prod/core/db";
import { summarize } from "@course-prod/core/providers/llm";
import { TerminalError } from "@course-prod/core/stages";
import { objectStore } from "../context.js";
import type { StageContext } from "../runner.js";

/**
 * §6.2 — the material becomes a structured lesson.
 *
 * This is the stage §12 calls the real risk: if it is not consistent across
 * different source documents, everything downstream is scaffolding around a
 * manual process. Hence the strict schema, the zod re-validation, and the raw
 * response preserved in stage_runs.log on failure.
 */
export async function handleSummarize(ctx: StageContext): Promise<void> {
  const { lesson, settings, log } = ctx;

  if (!lesson.sourceTextKey) {
    throw new TerminalError(
      "لا يوجد نص مستخرج. شغّل مرحلة استخراج النص أولاً.",
      "UNSUPPORTED_INPUT",
    );
  }

  const sourceText = (await objectStore().getObject(lesson.sourceTextKey)).toString("utf8");

  // Estimated before the call, because a budget block must prevent the spend
  // rather than report it afterwards (§7).
  const estimateCents = estimateSummarizeCents(sourceText.length, settings);
  await assertBudget(estimateCents, settings);

  const [course] = await getDb()
    .select({ market: courses.targetMarket, code: courses.code })
    .from(courses)
    .where(eq(courses.id, lesson.courseId))
    .limit(1);

  const dense = sourceText.length > settings.denseCharThreshold;

  log.info("summarizing", {
    chars: sourceText.length,
    dense,
    provider: settings.summarizeProvider,
  });

  const result = await summarize({
    lessonId: course?.code ? `${course.code}-${lesson.orderIndex}` : lesson.id,
    titleAr: lesson.titleAr,
    market: course?.market ?? "EG",
    sourceText,
    dense,
    settings,
  });

  ctx.charge(result.costCents);
  ctx.record({
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    repaired: result.repaired,
    slides: result.lesson.slides.length,
    quiz: result.lesson.quiz.length,
    // Kept so a producer disputing the output can see exactly what came back.
    raw_first_response: result.rawFirstResponse.slice(0, 20_000),
  });

  await getDb()
    .update(lessons)
    .set({ lessonJson: result.lesson, lessonVersion: 1, updatedAt: new Date() })
    .where(eq(lessons.id, lesson.id));

  log.info("lesson structured", {
    slides: result.lesson.slides.length,
    cost_cents: result.costCents,
    repaired: result.repaired,
  });
}

/**
 * Rough pre-flight estimate for the budget guard. Deliberately pessimistic:
 * under-estimating lets a run cross the ceiling, over-estimating only makes
 * the guard slightly eager, and the actual cost is recorded after the call.
 */
export function estimateSummarizeCents(
  sourceChars: number,
  settings: Parameters<typeof assertBudget>[1],
): number {
  const model =
    sourceChars > settings.denseCharThreshold ? settings.summarizeModelDense : settings.summarizeModel;
  const rate = settings.llmRates[model] ?? settings.llmFallbackRate;
  // ~4 chars per token for Arabic is optimistic; 3 is safer.
  const inputTokens = sourceChars / 3;
  const outputTokens = settings.summarizeMaxTokens;
  const usd =
    (inputTokens / 1_000_000) * rate.inputPerMTok + (outputTokens / 1_000_000) * rate.outputPerMTok;
  return Math.ceil(usd * 100);
}
