import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { TerminalError } from "@course-prod/core/stages";
import { createLogger } from "@course-prod/core/logger";

const exec = promisify(execFile);
const log = createLogger("extract");

/** §6.1 — accepted input formats and the 50 MB ceiling. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "pptx", "md", "txt"] as const;
export type AcceptedExtension = (typeof ACCEPTED_EXTENSIONS)[number];

/** §6.1 — warn the producer above roughly this size. */
export const CHAR_COUNT_WARN = 120_000;

export function isAccepted(ext: string): ext is AcceptedExtension {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export interface ExtractResult {
  text: string;
  charCount: number;
  method: string;
  warning?: string;
}

export async function extractText(buffer: Buffer, ext: string): Promise<ExtractResult> {
  const lower = ext.toLowerCase().replace(/^\./, "");
  if (!isAccepted(lower)) {
    throw new TerminalError(
      `صيغة .${lower} غير مدعومة. المدعوم: PDF، DOCX، PPTX، MD، TXT.`,
      "UNSUPPORTED_INPUT",
    );
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    const mb = (buffer.byteLength / 1024 / 1024).toFixed(0);
    throw new TerminalError(
      `الملف ${mb} MB والحد 50 MB. اضغط الملف أو قسّم المادة إلى دروس أصغر.`,
      "UNSUPPORTED_INPUT",
    );
  }

  const result = await extractByType(buffer, lower);
  const text = normalize(result.text);
  const charCount = text.length;

  if (charCount === 0) {
    throw new TerminalError(
      "لم يُستخرج أي نص من الملف. قد يكون ملفاً ممسوحاً ضوئياً (صور بلا نص). " +
        "استخدم نسخة نصية من المادة.",
      "UNSUPPORTED_INPUT",
    );
  }

  return {
    text,
    charCount,
    method: result.method,
    warning:
      charCount > CHAR_COUNT_WARN
        ? `النص المستخرج ${charCount.toLocaleString("en-US")} حرف. ` +
          `فوق ${CHAR_COUNT_WARN.toLocaleString("en-US")} تقل دقة الهيكلة وترتفع التكلفة. ` +
          `يُفضَّل تقسيم المادة إلى درسين.`
        : undefined,
  };
}

async function extractByType(buffer: Buffer, ext: string): Promise<{ text: string; method: string }> {
  switch (ext) {
    case "pdf":
      return extractPdf(buffer);
    case "docx": {
      const { value } = await mammoth.extractRawText({ buffer });
      return { text: value, method: "mammoth" };
    }
    case "pptx":
      return { text: extractPptx(buffer), method: "pptx-xml" };
    default:
      return { text: buffer.toString("utf8"), method: "utf8" };
  }
}

/**
 * pdftotext -layout, not pdf-parse.
 *
 * §6.1 lists pdf-parse first with pdftotext as the fallback; that order is
 * inverted here deliberately. poppler is already in the worker image (pdftoppm
 * is required for §6.5 anyway), and pdftotext handles Arabic shaping,
 * right-to-left runs and ligatures correctly, where pdf-parse routinely
 * returns reversed or mangled Arabic. Getting this wrong poisons the
 * summarizer's input, which is the M2 risk the spec flags.
 */
async function extractPdf(buffer: Buffer): Promise<{ text: string; method: string }> {
  const dir = await mkdtemp(join(tmpdir(), "cp-pdf-"));
  const src = join(dir, "in.pdf");
  const out = join(dir, "out.txt");
  try {
    await writeFile(src, buffer);
    await exec("pdftotext", ["-layout", "-enc", "UTF-8", src, out], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { text: await readFile(out, "utf8"), method: "pdftotext -layout" };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new TerminalError(
        "أداة pdftotext غير مثبّتة على الخادم. تأكّد من تثبيت poppler-utils في صورة العامل.",
        "UNSUPPORTED_INPUT",
      );
    }
    throw new TerminalError(
      `تعذّر قراءة ملف PDF: ${err.message}. قد يكون الملف تالفاً أو محمياً بكلمة مرور.`,
      "UNSUPPORTED_INPUT",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * PPTX is a zip of XML. Slide text lives in <a:t> nodes inside
 * ppt/slides/slideN.xml; notes live in notesSlides and are included because
 * speaker notes often carry the substance the slide only gestures at.
 */
function extractPptx(buffer: Buffer): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch (e) {
    throw new TerminalError(
      `تعذّر فتح ملف PPTX: ${(e as Error).message}`,
      "UNSUPPORTED_INPUT",
    );
  }

  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: "#text" });
  const decoder = new TextDecoder("utf-8");

  const slideNumber = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const names = Object.keys(files)
    .filter((n) => /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(n))
    .sort((a, b) => {
      const n = slideNumber(a) - slideNumber(b);
      // Slide before its notes when both share a number.
      return n !== 0 ? n : a.includes("notesSlides") ? 1 : -1;
    });

  const out: string[] = [];
  for (const name of names) {
    const xml = decoder.decode(files[name]!);
    const texts = collectText(parser.parse(xml));
    if (texts.length) {
      out.push(`--- ${name.includes("notes") ? "ملاحظات" : "شريحة"} ${slideNumber(name)} ---`);
      out.push(texts.join(" "));
    }
  }
  return out.join("\n");
}

/** Walks the parsed XML collecting every a:t text run, order preserved. */
function collectText(node: unknown, acc: string[] = []): string[] {
  if (node === null || node === undefined) return acc;
  if (typeof node === "string" || typeof node === "number") {
    const s = String(node).trim();
    if (s) acc.push(s);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, acc);
    return acc;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // a:t holds rendered text; a:fld and others are metadata we skip.
      if (key === "a:t" || key === "#text") collectText(value, acc);
      else if (typeof value === "object") collectText(value, acc);
    }
  }
  return acc;
}

/**
 * Normalises whitespace without touching the Arabic itself.
 *
 * Zero-width joiners and the BOM are stripped because they survive extraction,
 * count toward the ElevenLabs character bill, and can break whole-word matching
 * in the pronunciation dictionary by sitting between letters.
 */
function normalize(text: string): string {
  return text
    .replace(/﻿/g, "")
    .replace(/[​-‍]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export { log as extractLog };
