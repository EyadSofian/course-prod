import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import archiver from "archiver";
import { eq } from "drizzle-orm";
import { assets, courses, getDb } from "@course-prod/core/db";
import { lessonKey } from "@course-prod/core/storage";
import { TerminalError } from "@course-prod/core/stages";
import { objectStore } from "../context.js";
import { htmlToPdf, withTempDir } from "../media.js";
import { renderQuizHtml } from "../quiz-pdf.js";
import { upsertAsset } from "./export.js";
import type { StageContext } from "../runner.js";

/**
 * §6.8 — package everything into one zip with a manifest.
 *
 * The manifest is what Engosoft's existing LMS consumes; the zip is what a
 * producer hands over. Neither contains a third-party link (§1).
 */
export async function handlePublish(ctx: StageContext): Promise<void> {
  const { lesson, log } = ctx;
  const lessonJson = lesson.lessonJson;

  if (!lessonJson) {
    throw new TerminalError("لا يوجد درس مُهيكل.", "INVARIANT_VIOLATION");
  }

  const db = getDb();
  const store = objectStore();

  const [course] = await db
    .select({ titleAr: courses.titleAr, code: courses.code, market: courses.targetMarket })
    .from(courses)
    .where(eq(courses.id, lesson.courseId))
    .limit(1);

  // Quiz sheet, generated here rather than at assemble time because it is a
  // deliverable rather than an input to anything.
  const quizPdf = await htmlToPdf(
    renderQuizHtml(lessonJson, { courseTitle: course?.titleAr ?? "" }),
  );
  const quizKey = lessonKey.quizPdf(lesson.id);
  await store.putObject(quizKey, quizPdf);
  await upsertAsset(lesson.id, "quiz_pdf", null, quizKey, quizPdf.byteLength);

  const rows = await db.select().from(assets).where(eq(assets.lessonId, lesson.id));

  const manifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    lesson: {
      id: lesson.id,
      title_ar: lesson.titleAr,
      version: lesson.lessonVersion,
      duration_target_min: lessonJson.duration_target_min,
      slides: lessonJson.slides.length,
      quiz_questions: lessonJson.quiz.length,
    },
    course: course
      ? { title_ar: course.titleAr, code: course.code, market: course.market }
      : null,
    assets: rows.map((a) => ({
      kind: a.kind,
      slide_id: a.slideId,
      path: pathInZip(a.kind, a.slideId, a.storageKey),
      bytes: a.bytes,
    })),
  };

  await withTempDir("cp-package-", async (dir) => {
    const zipPath = join(dir, "package.zip");
    const archive = archiver("zip", { zlib: { level: 6 } });
    const out = createWriteStream(zipPath);

    // pipeline() rather than listening for 'close': it propagates errors from
    // either side, so a mid-write failure rejects instead of producing a
    // truncated zip that looks successful.
    const done = pipeline(archive, out);

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    archive.append(JSON.stringify(lessonJson, null, 2), { name: "course-lesson.json" });
    archive.append(JSON.stringify(lessonJson.quiz, null, 2), { name: "quiz/quiz.json" });

    for (const asset of rows) {
      const head = await store.headObject(asset.storageKey);
      if (!head.exists) {
        log.warn("asset missing from storage, omitted from package", { key: asset.storageKey });
        continue;
      }
      archive.append(await store.getObject(asset.storageKey), {
        name: pathInZip(asset.kind, asset.slideId, asset.storageKey),
      });
    }

    await archive.finalize();
    await done;

    const zip = await readFile(zipPath);
    const zipKey = lessonKey.packageZip(lesson.id);
    await store.putObject(zipKey, zip);
    await upsertAsset(lesson.id, "package_zip", null, zipKey, zip.byteLength);

    ctx.record({
      assets: rows.length,
      package_bytes: zip.byteLength,
      quiz_questions: lessonJson.quiz.length,
    });

    log.info("package published", {
      assets: rows.length,
      package_mb: (zip.byteLength / 1024 / 1024).toFixed(1),
    });
  });
}

/** Stable layout inside the zip, independent of internal storage keys. */
function pathInZip(kind: string, slideId: string | null, storageKey: string): string {
  const filename = storageKey.split("/").pop() ?? "file";
  switch (kind) {
    case "deck_pptx":
    case "deck_pdf":
      return `deck/${filename}`;
    case "slide_png":
      return `slides/${slideId ?? filename}.png`;
    case "audio_mp3":
      return `audio/${slideId ?? filename}.mp3`;
    case "audio_merged_mp3":
      return "audio/lesson.mp3";
    case "lesson_mp4":
      return "video/lesson.mp4";
    case "srt":
      return "video/lesson.srt";
    case "quiz_pdf":
      return "quiz/quiz.pdf";
    case "source_file":
    case "source_text":
      return `source/${filename}`;
    default:
      return filename;
  }
}
