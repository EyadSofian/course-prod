import { createLogger } from "../logger.js";
import { RetryableError, TerminalError } from "../stages.js";
import { TTS_CHAR_LIMITS, TTS_USD_PER_1K_CHARS, type Settings } from "../settings.js";

const log = createLogger("tts");

/**
 * ElevenLabs narration (§6.6). One MP3 per slide_id; re-generating one slide
 * must not touch the others, which is why this module is per-entry and knows
 * nothing about the lesson as a whole.
 */

export interface SynthesizeInput {
  /** Already through the pronunciation dictionary — this is text_tts. */
  text: string;
  voiceId: string;
  settings: Settings;
}

export interface SynthesizeResult {
  audio: Buffer;
  chars: number;
  costCents: number;
  /** How many API calls this took; >1 means the text was split. */
  chunks: number;
}

/**
 * Splits at sentence boundaries, never mid-word (§6.6).
 *
 * Arabic full stop is the ASCII '.', but the question mark is '؟' and the
 * comma '،'. Splitting on '.' alone leaves long question-heavy narration in
 * one oversized chunk.
 */
export function splitForTts(text: string, limit: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return [trimmed];

  // Keep the terminator attached to the sentence it ends.
  const sentences = trimmed.split(/(?<=[.!?؟])\s+/u).filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      // A single sentence over the limit: fall back to clause boundaries, then
      // to whitespace. Still never mid-word.
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongSentence(sentence, limit));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > limit) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLongSentence(sentence: string, limit: number): string[] {
  const parts = sentence.split(/(?<=[،,;:])\s+/u).filter(Boolean);
  const out: string[] = [];
  let current = "";

  const flushWords = (text: string) => {
    let line = "";
    for (const word of text.split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > limit) {
        if (line) out.push(line);
        line = word; // a single word longer than the limit is left intact
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  };

  for (const part of parts) {
    if (part.length > limit) {
      if (current) {
        out.push(current);
        current = "";
      }
      flushWords(part);
      continue;
    }
    const candidate = current ? `${current} ${part}` : part;
    if (candidate.length > limit) {
      out.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

export function estimateCostCents(chars: number, settings: Settings): number {
  const usd = (chars / 1000) * TTS_USD_PER_1K_CHARS[settings.ttsModel];
  return Math.round(usd * 100);
}

export async function synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new TerminalError(
      "مفتاح ElevenLabs غير مضبوط. أضف ELEVENLABS_API_KEY إلى إعدادات الخدمة.",
      "AUTH_FAILURE",
    );
  }
  if (!input.voiceId) {
    throw new TerminalError(
      "لم يُحدَّد صوت. اختر الصوت من الإعدادات أو اضبط ELEVENLABS_VOICE_ID.",
      "AUTH_FAILURE",
    );
  }

  const limit = TTS_CHAR_LIMITS[input.settings.ttsModel];
  const chunks = splitForTts(input.text, limit);

  const buffers: Buffer[] = [];
  let chars = 0;

  for (const [i, chunk] of chunks.entries()) {
    log.debug("synthesizing chunk", { chunk: i + 1, of: chunks.length, chars: chunk.length });
    buffers.push(await synthesizeOne(chunk, input.voiceId, input.settings, apiKey));
    chars += chunk.length;
  }

  return {
    // MP3 frames concatenate cleanly enough for a single slide's narration;
    // the assembler re-encodes anyway. Cross-slide joins go through ffmpeg.
    audio: Buffer.concat(buffers),
    chars,
    costCents: estimateCostCents(chars, input.settings),
    chunks: chunks.length,
  };
}

async function synthesizeOne(
  text: string,
  voiceId: string,
  settings: Settings,
  apiKey: string,
): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: settings.ttsModel,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  } catch (e) {
    throw new RetryableError(`تعذّر الوصول إلى ElevenLabs: ${(e as Error).message}`);
  }

  if (!res.ok) {
    // Read the body for diagnostics, but never log it wholesale — it echoes
    // request content and, on some errors, headers.
    const detail = (await res.text().catch(() => "")).slice(0, 500);

    if (res.status === 401 || res.status === 403) {
      throw new TerminalError("مفتاح ElevenLabs مرفوض.", "AUTH_FAILURE");
    }
    if (res.status === 422 || res.status === 400) {
      throw new TerminalError(`نص مرفوض من ElevenLabs: ${detail}`, "LIMIT_EXCEEDED");
    }
    if (res.status === 429) {
      throw new RetryableError("خدمة ElevenLabs مزدحمة.", 30_000);
    }
    if (res.status >= 500) {
      throw new RetryableError(`خطأ من خادم ElevenLabs (${res.status}).`);
    }
    throw new TerminalError(`فشل توليد الصوت (${res.status}): ${detail}`, "LIMIT_EXCEEDED");
  }

  return Buffer.from(await res.arrayBuffer());
}
