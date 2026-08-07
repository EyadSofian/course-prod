import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lessonKey } from "@course-prod/core/storage";
import { TerminalError } from "@course-prod/core/stages";
import { objectStore } from "../context.js";
import { audioDuration, concatMp3s, concatMp4s, slideToMp4, withTempDir } from "../media.js";
import { buildCues, renderSrt } from "../srt.js";
import { upsertAsset } from "./export.js";
import type { StageContext } from "../runner.js";

/**
 * §6.7 — slides plus narration become one MP4, with an SRT alongside.
 *
 * Pairing is by slide_id and nothing else (§13). No positional zip, no
 * assumption that the Nth PNG belongs with the Nth MP3 — the §4 invariant is
 * what guarantees the correspondence, and this stage reads it directly.
 */
export async function handleAssemble(ctx: StageContext): Promise<void> {
  const { lesson, log } = ctx;
  const lessonJson = lesson.lessonJson;

  if (!lessonJson) {
    throw new TerminalError("لا يوجد درس مُهيكل.", "INVARIANT_VIOLATION");
  }

  const store = objectStore();

  await withTempDir("cp-assemble-", async (dir) => {
    const partPaths: string[] = [];
    const audioParts: Buffer[] = [];
    const durations = new Map<string, number>();

    for (const [i, slide] of lessonJson.slides.entries()) {
      const pngKey = lessonKey.slidePng(lesson.id, slide.id);
      const mp3Key = lessonKey.audioMp3(lesson.id, slide.id);

      const [png, mp3] = await Promise.all([
        readAsset(store, pngKey, slide.id, "الصورة"),
        readAsset(store, mp3Key, slide.id, "المقطع الصوتي"),
      ]);

      durations.set(slide.id, await audioDuration(mp3));
      audioParts.push(mp3);

      const partPath = join(dir, `part-${String(i).padStart(3, "0")}.mp4`);
      await slideToMp4(png, mp3, partPath);
      partPaths.push(partPath);

      log.debug("slide rendered", { slide_id: slide.id, index: i + 1 });
    }

    const videoPath = join(dir, "lesson.mp4");
    await concatMp4s(partPaths, videoPath);
    const video = await readFile(videoPath);
    const videoKey = lessonKey.lessonMp4(lesson.id);
    await store.putObject(videoKey, video);
    await upsertAsset(lesson.id, "lesson_mp4", null, videoKey, video.byteLength);

    const mergedPath = join(dir, "lesson.mp3");
    await concatMp3s(audioParts, mergedPath);
    const merged = await readFile(mergedPath);
    const mergedKey = lessonKey.audioMerged(lesson.id);
    await store.putObject(mergedKey, merged);
    await upsertAsset(lesson.id, "audio_merged_mp3", null, mergedKey, merged.byteLength);

    // From text_raw — subtitles must show clean Arabic, never the TTS
    // pronunciation forms (§6.7, §13).
    const srt = renderSrt(buildCues(lessonJson, durations));
    const srtKey = lessonKey.srt(lesson.id);
    await store.putObject(srtKey, srt);
    await upsertAsset(lesson.id, "srt", null, srtKey, Buffer.byteLength(srt));

    const totalSec = [...durations.values()].reduce((a, b) => a + b, 0);
    ctx.record({
      slides: lessonJson.slides.length,
      video_bytes: video.byteLength,
      duration_sec: Math.round(totalSec),
    });

    log.info("assembled", {
      slides: lessonJson.slides.length,
      duration_sec: Math.round(totalSec),
      video_mb: (video.byteLength / 1024 / 1024).toFixed(1),
    });
  });
}

async function readAsset(
  store: ReturnType<typeof objectStore>,
  key: string,
  slideId: string,
  label: string,
): Promise<Buffer> {
  const head = await store.headObject(key);
  if (!head.exists || head.bytes === 0) {
    throw new TerminalError(
      `${label} مفقود للشريحة ${slideId}. أعد تشغيل المرحلة التي تنتجه قبل التجميع.`,
      "ASSET_COUNT_MISMATCH",
      { key },
    );
  }
  return store.getObject(key);
}
