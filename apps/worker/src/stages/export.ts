import { and, eq, isNull } from "drizzle-orm";
import { assets, getDb } from "@course-prod/core/db";
import { lessonKey } from "@course-prod/core/storage";
import { TerminalError } from "@course-prod/core/stages";
import { objectStore } from "../context.js";
import { exportDeck } from "../exporters/index.js";
import { pdfToPngs, pptxToPdf } from "../media.js";
import type { StageContext } from "../runner.js";

/**
 * §6.5 — get the actual file out of Dokie, then PPTX → PDF → one PNG per slide.
 *
 * This stage is free: it spends no credits and no characters, so unlike DECK
 * it is safe to retry.
 */
export async function handleExport(ctx: StageContext): Promise<void> {
  const { lesson, log } = ctx;

  if (!lesson.dokieProjectUrl) {
    throw new TerminalError(
      "لا يوجد رابط مشروع Dokie لهذا الدرس. شغّل مرحلة توليد العرض أولاً.",
      "INVARIANT_VIOLATION",
    );
  }
  const lessonJson = lesson.lessonJson;
  if (!lessonJson) {
    throw new TerminalError("لا يوجد درس مُهيكل.", "INVARIANT_VIOLATION");
  }

  const store = objectStore();

  log.info("exporting deck", { project_url: lesson.dokieProjectUrl });
  const pptx = await exportDeck(lesson.dokieProjectUrl, "pptx");
  const pptxKey = lessonKey.deckPptx(lesson.id);
  await store.putObject(pptxKey, pptx);
  await upsertAsset(lesson.id, "deck_pptx", null, pptxKey, pptx.byteLength);

  log.info("converting to pdf", { pptx_bytes: pptx.byteLength });
  const pdf = await pptxToPdf(pptx);
  const pdfKey = lessonKey.deckPdf(lesson.id);
  await store.putObject(pdfKey, pdf);
  await upsertAsset(lesson.id, "deck_pdf", null, pdfKey, pdf.byteLength);

  log.info("rendering slides to png");
  const pngs = await pdfToPngs(pdf);

  // §6.5: assert PNG count == slides.length; a mismatch is a hard failure.
  // Everything downstream pairs slide N with narration N, so a silent
  // off-by-one here would desynchronise the whole lesson.
  if (pngs.length !== lessonJson.slides.length) {
    throw new TerminalError(
      `نتج ${pngs.length} صورة من عرض يحتوي ${lessonJson.slides.length} شريحة. ` +
        `هذا الفرق يكسر التزامن بين الصوت والشرائح، فأُوقفت المرحلة. ` +
        `أعد تصدير العرض؛ إن تكرر الخطأ، افتح ملف PDF وحدّد الشريحة الناقصة.`,
      "ASSET_COUNT_MISMATCH",
      { png_count: pngs.length, slide_count: lessonJson.slides.length },
    );
  }

  let totalBytes = 0;
  for (const [i, png] of pngs.entries()) {
    const slideId = lessonJson.slides[i]!.id;
    const key = lessonKey.slidePng(lesson.id, slideId);
    await store.putObject(key, png);
    await upsertAsset(lesson.id, "slide_png", slideId, key, png.byteLength);
    totalBytes += png.byteLength;
  }

  ctx.record({
    pptx_bytes: pptx.byteLength,
    pdf_bytes: pdf.byteLength,
    png_count: pngs.length,
    png_bytes: totalBytes,
  });

  log.info("export complete", { slides: pngs.length });
}

/**
 * Replaces the row for this (lesson, kind, slide) rather than appending.
 * The UNIQUE NULLS NOT DISTINCT constraint makes this work for whole-lesson
 * assets too, where slide_id is NULL.
 */
export async function upsertAsset(
  lessonId: string,
  kind: typeof assets.$inferInsert.kind,
  slideId: string | null,
  storageKey: string,
  bytes: number,
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.lessonId, lessonId),
        eq(assets.kind, kind),
        // isNull, not eq(..., null): `slide_id = NULL` is never true, so every
        // whole-lesson asset would insert a duplicate on each re-export.
        slideId === null ? isNull(assets.slideId) : eq(assets.slideId, slideId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(assets)
      .set({ storageKey, bytes, createdAt: new Date() })
      .where(eq(assets.id, existing[0].id));
    return;
  }
  await db.insert(assets).values({ lessonId, kind, slideId, storageKey, bytes });
}
