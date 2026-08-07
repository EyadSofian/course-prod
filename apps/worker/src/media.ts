import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@course-prod/core/logger";
import { TerminalError } from "@course-prod/core/stages";

const exec = promisify(execFile);
const log = createLogger("media");

const BIG_BUFFER = 64 * 1024 * 1024;

async function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: timeoutMs, maxBuffer: BIG_BUFFER });
    return stdout || stderr;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
    if (err.code === "ENOENT") {
      throw new TerminalError(
        `الأداة ${cmd} غير مثبّتة على الخادم. تحقّق من صورة العامل (Dockerfile).`,
        "UNSUPPORTED_INPUT",
      );
    }
    if (err.killed) {
      throw new TerminalError(`تجاوزت ${cmd} المهلة المسموحة.`, "LIMIT_EXCEEDED");
    }
    throw new TerminalError(
      `فشل تنفيذ ${cmd}: ${(err.stderr ?? err.message ?? "").slice(0, 800)}`,
      "UNSUPPORTED_INPUT",
    );
  }
}

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * PPTX → PDF via headless LibreOffice (§6.5).
 *
 * -env:UserInstallation gives each invocation its own profile directory.
 * Without it, concurrent or previously-crashed soffice runs share ~/.config
 * and the second one silently exits without producing output.
 */
export async function pptxToPdf(pptx: Buffer): Promise<Buffer> {
  return withTempDir("cp-soffice-", async (dir) => {
    const src = join(dir, "deck.pptx");
    await writeFile(src, pptx);

    await run(
      "soffice",
      [
        `-env:UserInstallation=file://${join(dir, "profile")}`,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        src,
      ],
      10 * 60 * 1000,
    );

    const pdf = join(dir, "deck.pdf");
    try {
      return await readFile(pdf);
    } catch {
      throw new TerminalError(
        "لم يُنتج LibreOffice ملف PDF من العرض. قد يكون ملف PPTX تالفاً.",
        "UNSUPPORTED_INPUT",
      );
    }
  });
}

/**
 * PDF → one PNG per page at 150 dpi (§6.5).
 *
 * Returns pages in order. The caller asserts the count against slides.length —
 * a mismatch is a hard failure there, not here, because only the caller knows
 * how many slides the lesson has.
 */
export async function pdfToPngs(pdf: Buffer): Promise<Buffer[]> {
  return withTempDir("cp-poppler-", async (dir) => {
    const src = join(dir, "deck.pdf");
    await writeFile(src, pdf);

    await run("pdftoppm", ["-r", "150", "-png", src, join(dir, "slide")], 10 * 60 * 1000);

    const files = (await readdir(dir))
      .filter((f) => f.startsWith("slide") && f.endsWith(".png"))
      // pdftoppm numbers without fixed padding (slide-9, slide-10), so a
      // lexical sort would put slide-10 before slide-9.
      .sort((a, b) => pageNumber(a) - pageNumber(b));

    if (files.length === 0) {
      throw new TerminalError("لم تُنتج أي صور من ملف PDF.", "ASSET_COUNT_MISMATCH");
    }
    return Promise.all(files.map((f) => readFile(join(dir, f))));
  });
}

function pageNumber(filename: string): number {
  return Number(filename.match(/-(\d+)\.png$/)?.[1] ?? 0);
}

/** Duration in seconds, used to build the SRT timeline (§6.7). */
export async function audioDuration(mp3: Buffer): Promise<number> {
  return withTempDir("cp-probe-", async (dir) => {
    const src = join(dir, "audio.mp3");
    await writeFile(src, mp3);
    const out = await run(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        src,
      ],
      60_000,
    );
    const seconds = Number.parseFloat(out.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new TerminalError("تعذّر قراءة مدة المقطع الصوتي.", "UNSUPPORTED_INPUT");
    }
    return seconds;
  });
}

/** One still image + its narration → one MP4 (§6.7). */
export async function slideToMp4(png: Buffer, mp3: Buffer, outPath: string): Promise<void> {
  await withTempDir("cp-slide-", async (dir) => {
    const image = join(dir, "slide.png");
    const audio = join(dir, "audio.mp3");
    await writeFile(image, png);
    await writeFile(audio, mp3);

    await run(
      "ffmpeg",
      [
        "-y",
        "-loop", "1",
        "-i", image,
        "-i", audio,
        "-c:v", "libx264",
        "-tune", "stillimage",
        "-c:a", "aac",
        "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        // Pad to exactly 1080p: H.264 requires even dimensions, and slide
        // renders vary by a pixel or two, which otherwise fails the encode.
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-shortest",
        outPath,
      ],
      15 * 60 * 1000,
    );
  });
}

/**
 * Concatenates per-slide MP4s with the concat demuxer (§6.7).
 *
 * Every part is produced by slideToMp4 above, so they share codec, resolution
 * and SAR — which is exactly the precondition the demuxer needs to copy
 * streams instead of re-encoding.
 */
export async function concatMp4s(parts: string[], outPath: string): Promise<void> {
  if (parts.length === 0) {
    throw new TerminalError("لا توجد مقاطع لتجميعها.", "ASSET_COUNT_MISMATCH");
  }

  await withTempDir("cp-concat-", async (dir) => {
    const listFile = join(dir, "parts.txt");
    await writeFile(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

    await run(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath],
      20 * 60 * 1000,
    );
  });
}

/** Merged narration track for the package (§1). */
export async function concatMp3s(parts: Buffer[], outPath: string): Promise<void> {
  await withTempDir("cp-audio-", async (dir) => {
    const files: string[] = [];
    for (const [i, part] of parts.entries()) {
      const p = join(dir, `part-${String(i).padStart(3, "0")}.mp3`);
      await writeFile(p, part);
      files.push(p);
    }
    const listFile = join(dir, "parts.txt");
    await writeFile(listFile, files.map((p) => `file '${p}'`).join("\n"));

    await run(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath],
      10 * 60 * 1000,
    );
  });
}

/**
 * HTML → PDF through the headless browser already in the image.
 *
 * Used for the quiz sheet. A PDF library would need Arabic shaping, bidi and
 * an embedded Arabic font wired up by hand; Chromium already does all three
 * correctly, and the image carries it for the export fallback regardless.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

export { log as mediaLog };
