import { BLOOM_LEVELS, MARKETS, SLIDE_LAYOUTS } from "../schema/lesson.js";

/**
 * JSON Schema handed to the model for strict structured output.
 *
 * Deliberately hand-written rather than derived from the zod schema. OpenAI's
 * strict mode accepts only a subset of JSON Schema — every property must be
 * required, `additionalProperties` must be false, and defaults are not allowed
 * — whereas the zod schema in ../schema/lesson.ts uses defaults and a
 * superRefine for the §4 invariant, none of which survive translation.
 *
 * The two are kept deliberately separate: this one constrains *generation*,
 * zod independently validates the *response* (§4 — validate at every
 * boundary). A model that satisfies this schema can still violate the
 * narration/slide invariant, which is exactly what zod is there to catch.
 */
export function buildLessonJsonSchema(slideCap: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "lesson_id",
      "title_ar",
      "duration_target_min",
      "market",
      "objectives",
      "slides",
      "narration",
      "quiz",
    ],
    properties: {
      schema_version: { type: "integer", enum: [1] },
      lesson_id: { type: "string" },
      title_ar: { type: "string" },
      duration_target_min: { type: "integer" },
      market: { type: "string", enum: [...MARKETS] },
      objectives: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: { type: "string" },
      },
      slides: {
        type: "array",
        minItems: 1,
        maxItems: slideCap,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "layout", "title_ar", "bullets", "visual_cue", "speaker_note_ar"],
          properties: {
            id: { type: "string", description: "s01, s02, … zero-padded, sequential" },
            layout: { type: "string", enum: [...SLIDE_LAYOUTS] },
            title_ar: { type: "string", description: "سبع كلمات كحد أقصى" },
            bullets: {
              type: "array",
              maxItems: 5,
              items: { type: "string", description: "١٢ كلمة كحد أقصى" },
            },
            visual_cue: { type: "string" },
            speaker_note_ar: { type: "string" },
          },
        },
      },
      narration: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slide_id", "text_raw", "text_tts", "est_chars"],
          properties: {
            slide_id: { type: "string", description: "must equal a slides[].id" },
            text_raw: { type: "string" },
            // The model is told to leave this empty: text_tts is produced by
            // the pronunciation dictionary at narration time (§6.6), never by
            // the summarizer. Asking for it here would invite invented tashkeel.
            text_tts: { type: "string", description: "اتركه فارغاً" },
            est_chars: { type: "integer" },
          },
        },
      },
      quiz: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "type",
            "question_ar",
            "options_ar",
            "answer_index",
            "explanation_ar",
            "bloom",
            "slide_ref",
          ],
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: ["mcq"] },
            question_ar: { type: "string" },
            options_ar: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
            answer_index: { type: "integer", minimum: 0, maximum: 3 },
            explanation_ar: { type: "string" },
            bloom: { type: "string", enum: [...BLOOM_LEVELS] },
            slide_ref: { type: "string" },
          },
        },
      },
    },
  } as const;
}
