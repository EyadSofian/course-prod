import { z } from "zod";

/**
 * The canonical artifact (§4). One object, versioned, validated at every
 * boundary. Everything downstream reads from here.
 */

export const SCHEMA_VERSION = 1;

export const SLIDE_LAYOUTS = [
  "title",
  "objectives",
  "concept",
  "comparison",
  "steps",
  "data",
  "summary",
  "question",
] as const;

export const BLOOM_LEVELS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

export const MARKETS = ["EG", "KSA", "GULF"] as const;

/** §14 rule 2: titles ≤ 7 words, ≤ 5 bullets per slide, ≤ 12 words per bullet. */
export const MAX_TITLE_WORDS = 7;
export const MAX_BULLETS_PER_SLIDE = 5;
export const MAX_WORDS_PER_BULLET = 12;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Slide ids are `s01`, `s02`, … — zero-padded so lexical order is slide order. */
export const slideIdSchema = z
  .string()
  .regex(/^s\d{2,3}$/, "slide id must look like s01");

export const slideSchema = z.object({
  id: slideIdSchema,
  layout: z.enum(SLIDE_LAYOUTS),
  title_ar: z
    .string()
    .min(1)
    .refine((v) => wordCount(v) <= MAX_TITLE_WORDS, {
      message: `العنوان أطول من ${MAX_TITLE_WORDS} كلمات`,
    }),
  bullets: z
    .array(
      z.string().min(1).refine((v) => wordCount(v) <= MAX_WORDS_PER_BULLET, {
        message: `النقطة أطول من ${MAX_WORDS_PER_BULLET} كلمة`,
      }),
    )
    .max(MAX_BULLETS_PER_SLIDE, `الحد ${MAX_BULLETS_PER_SLIDE} نقاط لكل شريحة`),
  visual_cue: z.string().default(""),
  speaker_note_ar: z.string().default(""),
});

/**
 * text_raw and text_tts are deliberately separate and must never be collapsed
 * (§13). Subtitles are generated from text_raw; only text_tts carries the
 * pronunciation-dictionary substitutions and selective tashkeel.
 */
export const narrationSchema = z.object({
  slide_id: slideIdSchema,
  text_raw: z.string().min(1),
  text_tts: z.string().default(""),
  est_chars: z.number().int().nonnegative().default(0),
});

export const quizItemSchema = z.object({
  id: z.string().min(1),
  type: z.literal("mcq"),
  question_ar: z.string().min(1),
  options_ar: z.array(z.string().min(1)).length(4, "أربعة بدائل بالضبط"),
  answer_index: z.number().int().min(0).max(3),
  explanation_ar: z.string().min(1),
  bloom: z.enum(BLOOM_LEVELS),
  slide_ref: slideIdSchema,
});

const baseLessonSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  lesson_id: z.string().min(1),
  title_ar: z.string().min(1),
  duration_target_min: z.number().int().positive(),
  market: z.enum(MARKETS),
  objectives: z.array(z.string().min(1)).min(3).max(5),
  slides: z.array(slideSchema).min(1),
  narration: z.array(narrationSchema).min(1),
  quiz: z.array(quizItemSchema),
});

/**
 * THE invariant (§4): every narration[].slide_id exists in slides[], and the
 * counts match. Audio/slide sync is guaranteed here, not at assembly time — by
 * the time ffmpeg is running it is far too late and far more expensive.
 *
 * Attached to the schema itself so there is no path that parses a lesson
 * without checking it.
 */
export const lessonJsonSchema = baseLessonSchema.superRefine((lesson, ctx) => {
  const slideIds = lesson.slides.map((s) => s.id);
  const slideIdSet = new Set(slideIds);

  if (slideIdSet.size !== slideIds.length) {
    const seen = new Set<string>();
    const dupes = slideIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["slides"],
      message: `معرّفات شرائح مكرّرة: ${[...new Set(dupes)].join("، ")}`,
    });
  }

  if (lesson.narration.length !== lesson.slides.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["narration"],
      message:
        `عدد نصوص السرد لا يطابق عدد الشرائح — ` +
        `${lesson.narration.length} سرد مقابل ${lesson.slides.length} شريحة`,
    });
  }

  const narratedIds = new Set<string>();
  lesson.narration.forEach((n, i) => {
    if (!slideIdSet.has(n.slide_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["narration", i, "slide_id"],
        message: `السرد يشير إلى شريحة غير موجودة: ${n.slide_id}`,
      });
    }
    if (narratedIds.has(n.slide_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["narration", i, "slide_id"],
        message: `أكثر من سرد للشريحة ${n.slide_id}`,
      });
    }
    narratedIds.add(n.slide_id);
  });

  for (const id of slideIds) {
    if (!narratedIds.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["narration"],
        message: `لا يوجد سرد للشريحة ${id}`,
      });
    }
  }

  lesson.quiz.forEach((q, i) => {
    if (!slideIdSet.has(q.slide_ref)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quiz", i, "slide_ref"],
        message: `السؤال ${q.id} يشير إلى شريحة محذوفة (${q.slide_ref})`,
      });
    }
  });
});

export type LessonJson = z.infer<typeof baseLessonSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type Narration = z.infer<typeof narrationSchema>;
export type QuizItem = z.infer<typeof quizItemSchema>;

/**
 * §6.2: the model is told to emit JSON only, but strip fences defensively
 * anyway. Handles ```json … ```, bare ``` … ```, and stray prose either side of
 * the first balanced object.
 */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();

  const fence = s.match(/^```(?:json|jsonc)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence?.[1]) s = fence[1].trim();

  if (s.startsWith("{") && s.endsWith("}")) return s;

  // Fall back to the first balanced top-level object, ignoring braces inside
  // strings so Arabic text containing { or } cannot truncate the parse.
  const start = s.indexOf("{");
  if (start === -1) return s;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

export interface ParseResult {
  ok: boolean;
  lesson?: LessonJson;
  /** Human-readable, fed back to the model verbatim on the single repair attempt (§6.2). */
  errorText?: string;
  issues?: z.ZodIssue[];
}

export function parseLessonJson(raw: string): ParseResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(stripJsonFences(raw));
  } catch (e) {
    return { ok: false, errorText: `Invalid JSON: ${(e as Error).message}` };
  }

  const result = lessonJsonSchema.safeParse(candidate);
  if (!result.success) {
    const errorText = result.error.issues
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return { ok: false, errorText, issues: result.error.issues };
  }
  return { ok: true, lesson: result.data };
}

/**
 * Renumbers slides to s01..sNN after a reorder, moving each narration entry and
 * quiz slide_ref with its slide (§6.3). Ordering is coupled to slide_id and to
 * nothing else (§13) — callers pass the slides in their new order and the
 * mapping is derived, never assumed positional.
 */
export function renumberSlides(lesson: LessonJson): LessonJson {
  const remap = new Map<string, string>();
  const slides = lesson.slides.map((slide, i) => {
    const nextId = `s${String(i + 1).padStart(2, "0")}`;
    remap.set(slide.id, nextId);
    return { ...slide, id: nextId };
  });

  const byOldId = new Map(lesson.narration.map((n) => [n.slide_id, n]));
  const narration = lesson.slides.flatMap((slide) => {
    const entry = byOldId.get(slide.id);
    if (!entry) return [];
    return [{ ...entry, slide_id: remap.get(slide.id)! }];
  });

  const quiz = lesson.quiz.map((q) => ({
    ...q,
    slide_ref: remap.get(q.slide_ref) ?? q.slide_ref,
  }));

  return { ...lesson, slides, narration, quiz };
}
