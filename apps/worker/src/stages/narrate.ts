import { eq, or } from "drizzle-orm";
import { assertBudget } from "@course-prod/core/costs";
import { getDb, lessons, pronunciations } from "@course-prod/core/db";
import { applyPronunciations, type PronunciationEntry } from "@course-prod/core/pronunciation";
import { estimateCostCents, synthesize } from "@course-prod/core/providers/tts";
import { lessonKey } from "@course-prod/core/storage";
import { TerminalError } from "@course-prod/core/stages";
import { objectStore } from "../context.js";
import { upsertAsset } from "./export.js";
import type { StageContext } from "../runner.js";

/**
 * §6.6 — narration.
 *
 * Order matters: the pronunciation dictionary runs first, producing text_tts
 * from text_raw. text_raw is never sent to ElevenLabs and text_tts is never
 * used for subtitles (§13); the two fields exist precisely so neither
 * substitution leaks into the other's output.
 */
export async function handleNarrate(ctx: StageContext): Promise<void> {
  const { lesson, settings, log } = ctx;
  const lessonJson = lesson.lessonJson;

  if (!lessonJson) {
    throw new TerminalError("لا يوجد درس مُهيكل.", "INVARIANT_VIOLATION");
  }

  const voiceId = settings.voiceId || process.env.ELEVENLABS_VOICE_ID || "";
  const dictionary = await loadDictionary(lesson.courseId);

  // Apply the dictionary to every entry up front so the cost is known before
  // a single character is billed (§7).
  const prepared = lessonJson.narration.map((entry) => {
    const applied = applyPronunciations(entry.text_raw, dictionary);
    return { slideId: entry.slide_id, textTts: applied.text, chars: applied.text.length };
  });

  const totalChars = prepared.reduce((sum, p) => sum + p.chars, 0);
  await assertBudget(estimateCostCents(totalChars, settings), settings);

  // Only regenerate what is missing, unless the producer forced a full re-run.
  // §6.6: re-generating one slide must not touch the others.
  const store = objectStore();
  const existing = ctx.force ? new Set<string>() : await existingAudio(store, lesson.id, prepared);

  log.info("narrating", {
    slides: prepared.length,
    total_chars: totalChars,
    skipping: existing.size,
    voice: voiceId ? "set" : "missing",
  });

  const updatedNarration = [...lessonJson.narration];
  let generated = 0;
  let billedChars = 0;

  for (const [i, item] of prepared.entries()) {
    const key = lessonKey.audioMp3(lesson.id, item.slideId);

    if (existing.has(item.slideId)) {
      log.debug("audio already present, skipping", { slide_id: item.slideId });
    } else {
      const result = await synthesize({ text: item.textTts, voiceId, settings });
      await store.putObject(key, result.audio);
      await upsertAsset(lesson.id, "audio_mp3", item.slideId, key, result.audio.byteLength);

      ctx.charge(result.costCents);
      billedChars += result.chars;
      generated++;
      log.info("slide narrated", {
        slide_id: item.slideId,
        chars: result.chars,
        chunks: result.chunks,
      });
    }

    // Persist text_tts so the review editor and the assembler see exactly what
    // was spoken, rather than recomputing it against a since-edited dictionary.
    const entry = updatedNarration[i];
    if (entry) {
      updatedNarration[i] = { ...entry, text_tts: item.textTts, est_chars: item.chars };
    }
  }

  await getDb()
    .update(lessons)
    .set({
      lessonJson: { ...lessonJson, narration: updatedNarration },
      updatedAt: new Date(),
    })
    .where(eq(lessons.id, lesson.id));

  ctx.record({
    slides: prepared.length,
    generated,
    skipped: prepared.length - generated,
    billed_chars: billedChars,
    dictionary_terms: dictionary.length,
  });
}

/**
 * Global entries plus any scoped to this lesson's course (§3).
 *
 * Course-scoped entries come first because applyPronunciations keeps the first
 * definition it sees for a given term — so a course override must precede the
 * global default, not follow it.
 */
async function loadDictionary(courseId: string): Promise<PronunciationEntry[]> {
  const rows = await getDb()
    .select({
      term: pronunciations.term,
      replacement: pronunciations.replacement,
      scope: pronunciations.scope,
    })
    .from(pronunciations)
    .where(or(eq(pronunciations.scope, "global"), eq(pronunciations.courseId, courseId)));

  const courseScoped = rows.filter((r) => r.scope === "course");
  const global = rows.filter((r) => r.scope !== "course");

  return [...courseScoped, ...global].map(({ term, replacement }) => ({ term, replacement }));
}

async function existingAudio(
  store: ReturnType<typeof objectStore>,
  lessonId: string,
  prepared: { slideId: string }[],
): Promise<Set<string>> {
  const present = new Set<string>();
  for (const item of prepared) {
    const head = await store.headObject(lessonKey.audioMp3(lessonId, item.slideId));
    if (head.exists && head.bytes > 0) present.add(item.slideId);
  }
  return present;
}
