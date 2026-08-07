import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPronunciations,
  countTashkeel,
  hasTashkeel,
  looksAutoDiacritized,
} from "../dist/pronunciation.js";
import { splitForTts } from "../dist/providers/tts.js";

/** The §6.6 seed dictionary. */
const SEED = [
  { term: "انجوسوفت", replacement: "Engosoft" },
  { term: "PMP", replacement: "بي إم بي" },
  { term: "PMBOK", replacement: "بيم-بوك" },
  { term: "Agile", replacement: "أَجايِل" },
];

test("§6.6 applies whole-word replacements in Arabic and Latin", () => {
  const result = applyPronunciations("دورة PMP من انجوسوفت", SEED);
  assert.equal(result.text, "دورة بي إم بي من Engosoft");
});

test("§6.6 does not match inside a longer word", () => {
  // The classic failure: replacing PMP inside PMPX, or a bare \b on Arabic
  // matching at every letter boundary.
  const result = applyPronunciations("PMPX ليست PMP", SEED);
  assert.equal(result.text, "PMPX ليست بي إم بي");
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].count, 1);
});

test("§6.6 longest term wins where two could match", () => {
  const result = applyPronunciations("مرجع PMBOK", SEED);
  assert.equal(result.text, "مرجع بيم-بوك");
});

test("§6.6 a replacement is never re-matched by another rule", () => {
  // "PMP" -> "بي إم بي"; a rule for "بي" must not then rewrite the output.
  const dict = [
    { term: "PMP", replacement: "بي إم بي" },
    { term: "بي", replacement: "XX" },
  ];
  const result = applyPronunciations("شهادة PMP", dict);
  assert.equal(result.text, "شهادة بي إم بي");
});

test("§6.6 reports the character delta and per-term counts", () => {
  const result = applyPronunciations("PMP و PMP", [
    { term: "PMP", replacement: "بي إم بي" },
  ]);
  assert.equal(result.applied[0].count, 2);
  assert.equal(result.charDelta, result.text.length - "PMP و PMP".length);
  assert.ok(result.charDelta > 0, "a longer replacement must report a positive delta");
});

test("§6.6 an Arabic term surrounded by punctuation still matches", () => {
  const result = applyPronunciations("«انجوسوفت»، ثم انجوسوفت.", SEED);
  assert.equal(result.text, "«Engosoft»، ثم Engosoft.");
});

test("§6.6 tashkeel counting drives the cost preview", () => {
  assert.ok(hasTashkeel("أَجايِل"));
  assert.ok(!hasTashkeel("Agile"));
  assert.equal(countTashkeel("أَجايِل"), 2);
});

test("§13 flags a hand-diacritized script", () => {
  assert.ok(looksAutoDiacritized("الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ"));
  assert.ok(!looksAutoDiacritized("الحمد لله رب العالمين"));
});

test("empty dictionary leaves text untouched", () => {
  const result = applyPronunciations("نص كما هو", []);
  assert.equal(result.text, "نص كما هو");
  assert.equal(result.charDelta, 0);
});

test("§6.6 TTS splitting never breaks a word and respects the limit", () => {
  const sentence = "هذه جملة عربية قصيرة. ";
  const text = sentence.repeat(40).trim();
  const chunks = splitForTts(text, 200);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= 200, `chunk of ${chunk.length} exceeds the limit`);
  }
  // Every word survives the split intact.
  assert.deepEqual(chunks.join(" ").split(/\s+/), text.split(/\s+/));
});

test("§6.6 splitting handles Arabic question marks as sentence ends", () => {
  const text = "ما هو المشروع؟ ".repeat(30).trim();
  const chunks = splitForTts(text, 100);
  for (const chunk of chunks) assert.ok(chunk.length <= 100);
  assert.ok(chunks.length > 1, "should have split on ؟");
});

test("§6.6 text under the limit is a single chunk", () => {
  assert.deepEqual(splitForTts("نص قصير", 3000), ["نص قصير"]);
});
