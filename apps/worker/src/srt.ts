import type { LessonJson } from "@course-prod/core/schema";

/**
 * SRT generation (§6.7).
 *
 * Subtitles are built from text_raw, never text_tts (§13). text_tts carries
 * pronunciation hacks — "PMP" rewritten as "بي إم بي", tashkeel added to force
 * a reading — which are correct for a speech engine and wrong on screen. A
 * trainee reading "بي إم بي" as a subtitle would see gibberish where the
 * certification name should be.
 */

export interface SrtCue {
  slideId: string;
  startSec: number;
  endSec: number;
  text: string;
}

/** Splits one slide's narration across its duration, proportional to length. */
export function buildCues(
  lesson: LessonJson,
  durationsBySlide: Map<string, number>,
  maxCharsPerCue = 90,
): SrtCue[] {
  const cues: SrtCue[] = [];
  let clock = 0;

  for (const slide of lesson.slides) {
    const narration = lesson.narration.find((n) => n.slide_id === slide.id);
    const duration = durationsBySlide.get(slide.id) ?? 0;
    if (!narration || duration <= 0) {
      clock += duration;
      continue;
    }

    const segments = splitForSubtitles(narration.text_raw, maxCharsPerCue);
    const totalChars = segments.reduce((sum, s) => sum + s.length, 0) || 1;

    let offset = 0;
    for (const segment of segments) {
      // Proportional to character share — crude, but it tracks speech rate far
      // better than dividing the slide's time evenly across segments.
      const share = (segment.length / totalChars) * duration;
      cues.push({
        slideId: slide.id,
        startSec: clock + offset,
        endSec: clock + offset + share,
        text: segment,
      });
      offset += share;
    }
    clock += duration;
  }

  return cues;
}

/** Sentence-first, falling back to word wrapping. Never splits mid-word. */
export function splitForSubtitles(text: string, maxChars: number): string[] {
  const sentences = text
    .trim()
    .split(/(?<=[.!?؟])\s+/u)
    .filter(Boolean);

  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    let line = "";
    for (const word of sentence.split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > maxChars) {
        if (line) out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [text.trim()];
}

export function renderSrt(cues: SrtCue[]): string {
  return (
    cues
      .map((cue, i) =>
        [
          String(i + 1),
          `${timestamp(cue.startSec)} --> ${timestamp(cue.endSec)}`,
          cue.text,
          "",
        ].join("\n"),
      )
      .join("\n") + "\n"
  );
}

/** SRT wants HH:MM:SS,mmm — comma for the decimal separator, not a period. */
export function timestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}
