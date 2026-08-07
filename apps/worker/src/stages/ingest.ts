import { eq } from "drizzle-orm";
import { lessonKey } from "@course-prod/core/storage";
import { TerminalError } from "@course-prod/core/stages";
import { getDb, lessons } from "@course-prod/core/db";
import { objectStore } from "../context.js";
import { extractText } from "../extract.js";
import type { StageContext } from "../runner.js";

/**
 * §6.1 — extract text from the uploaded source and store it alongside the raw
 * file. The raw file is kept: re-running extraction after an extractor fix
 * must not require the producer to upload again.
 */
export async function handleIngest(ctx: StageContext): Promise<void> {
  const { lesson, log } = ctx;

  if (!lesson.sourceFileKey) {
    throw new TerminalError(
      "لا يوجد ملف مصدر لهذا الدرس. ارفع المادة العلمية أولاً.",
      "UNSUPPORTED_INPUT",
    );
  }

  const store = objectStore();
  const buffer = await store.getObject(lesson.sourceFileKey);
  const ext = lesson.sourceFileKey.split(".").pop() ?? "";

  log.info("extracting text", { bytes: buffer.byteLength, ext });

  const result = await extractText(buffer, ext);
  const textKey = lessonKey.sourceText(lesson.id);
  await store.putObject(textKey, result.text);

  await getDb()
    .update(lessons)
    .set({ sourceTextKey: textKey, sourceCharCount: result.charCount, updatedAt: new Date() })
    .where(eq(lessons.id, lesson.id));

  ctx.record({
    method: result.method,
    char_count: result.charCount,
    bytes: buffer.byteLength,
    ...(result.warning ? { warning: result.warning } : {}),
  });

  log.info("text extracted", { chars: result.charCount, method: result.method });
}
