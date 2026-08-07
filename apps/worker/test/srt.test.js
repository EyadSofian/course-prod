import assert from "node:assert/strict";
import test from "node:test";

import { buildCues, renderSrt, splitForSubtitles, timestamp } from "../dist/srt.js";

const slide = (id) => ({
  id,
  layout: "concept",
  title_ar: "عنوان",
  bullets: [],
  visual_cue: "",
  speaker_note_ar: "",
});

/** text_raw is clean Arabic; text_tts carries the pronunciation hacks. */
const lesson = {
  schema_version: 1,
  lesson_id: "l",
  title_ar: "درس",
  duration_target_min: 10,
  market: "KSA",
  objectives: ["أ", "ب", "ج"],
  slides: [slide("s01"), slide("s02")],
  narration: [
    { slide_id: "s01", text_raw: "شهادة PMP مهمة.", text_tts: "شهادة بي إم بي مهمة.", est_chars: 16 },
    { slide_id: "s02", text_raw: "منهجية Agile.", text_tts: "منهجية أَجايِل.", est_chars: 13 },
  ],
  quiz: [],
};

test("§13 subtitles come from text_raw, never text_tts", () => {
  const cues = buildCues(lesson, new Map([["s01", 4], ["s02", 3]]));
  const text = cues.map((c) => c.text).join(" ");

  assert.ok(text.includes("PMP"), "clean Arabic must survive into the subtitles");
  assert.ok(!text.includes("بي إم بي"), "the TTS pronunciation form must never appear");
  assert.ok(!text.includes("أَجايِل"), "tashkeel from the dictionary must never appear");
});

test("cues advance monotonically and stay inside the total duration", () => {
  const cues = buildCues(lesson, new Map([["s01", 4], ["s02", 3]]));
  assert.ok(cues.length >= 2);

  let previousEnd = 0;
  for (const cue of cues) {
    assert.ok(cue.startSec >= previousEnd - 1e-6, "cues must not overlap");
    assert.ok(cue.endSec >= cue.startSec, "a cue must not end before it starts");
    previousEnd = cue.endSec;
  }
  assert.ok(previousEnd <= 7 + 1e-6, "cues must fit within the summed audio duration");
});

test("a slide with no audio does not consume timeline or emit cues", () => {
  const cues = buildCues(lesson, new Map([["s01", 4]]));
  assert.ok(cues.every((c) => c.slideId === "s01"));
});

test("SRT timestamps use HH:MM:SS,mmm with a comma", () => {
  assert.equal(timestamp(0), "00:00:00,000");
  assert.equal(timestamp(3.5), "00:00:03,500");
  assert.equal(timestamp(61.25), "00:01:01,250");
  assert.equal(timestamp(3661.001), "01:01:01,001");
  // Negative input must not produce a malformed stamp.
  assert.equal(timestamp(-5), "00:00:00,000");
});

test("rendered SRT is well formed", () => {
  const srt = renderSrt([
    { slideId: "s01", startSec: 0, endSec: 2, text: "سطر أول" },
    { slideId: "s01", startSec: 2, endSec: 4, text: "سطر ثانٍ" },
  ]);
  const blocks = srt.trim().split("\n\n");
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].startsWith("1\n00:00:00,000 --> 00:00:02,000\n"));
  assert.ok(blocks[1].startsWith("2\n"));
});

test("subtitle splitting never breaks a word", () => {
  const text = "كلمة ".repeat(60).trim();
  const parts = splitForSubtitles(text, 40);
  for (const part of parts) assert.ok(part.length <= 40, `part too long: ${part.length}`);
  assert.deepEqual(parts.join(" ").split(/\s+/), text.split(/\s+/));
});
