import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "../dist/logger.js";
import { parseLessonJson, renumberSlides, stripJsonFences } from "../dist/schema/lesson.js";
import { createSessionToken, verifySessionToken } from "../dist/session.js";
import { hashPassword, verifyPassword } from "../dist/password.js";
import { assertSafeKey, signKey, verifySignedKey } from "../dist/storage/index.js";

/**
 * Runs against dist, so `pnpm build` first (the test script does it).
 *
 * These cover the guarantees the rest of the pipeline is built on: if the §4
 * invariant or the redaction rules regress, every later milestone inherits the
 * damage silently.
 */

const SECRET = "x".repeat(40);
const UID = "123e4567-e89b-12d3-a456-426614174000";

const slide = (id) => ({
  id,
  layout: "concept",
  title_ar: "عنوان قصير",
  bullets: ["نقطة"],
  visual_cue: "",
  speaker_note_ar: "",
});
const narr = (id, text = "نص") => ({ slide_id: id, text_raw: text, text_tts: "", est_chars: 3 });
const lesson = (slides, narration, quiz = []) =>
  JSON.stringify({
    schema_version: 1,
    lesson_id: "pmp-02",
    title_ar: "إدارة تكامل المشروع",
    duration_target_min: 10,
    market: "KSA",
    objectives: ["هدف أول", "هدف ثانٍ", "هدف ثالث"],
    slides,
    narration,
    quiz,
  });

test("§10 logger redacts secrets by key name, at any depth", () => {
  const written = [];
  // Injected sink, not a stdout monkeypatch: stdout is where the test runner
  // writes TAP, and stealing it corrupts the whole run.
  const log = createLogger("t", {}, (_level, line) => written.push(line));
  log.info("x", {
    password: "hunter2",
    nested: { api_key: "sk-ant-abc" },
    cookie: "a=b",
    storageState: { c: 1 },
    lesson_id: "L1",
  });

  const out = written.join("");
  assert.ok(!out.includes("hunter2"), "password leaked");
  assert.ok(!out.includes("sk-ant-abc"), "nested api_key leaked");
  assert.ok(!out.includes("a=b"), "cookie leaked");
  assert.ok(!out.includes('"c":1'), "storageState leaked");
  assert.ok(out.includes("L1"), "lesson_id should survive redaction");
});

test("§4 invariant: narration and slides must correspond exactly", () => {
  assert.ok(parseLessonJson(lesson([slide("s01"), slide("s02")], [narr("s01"), narr("s02")])).ok);

  assert.ok(
    !parseLessonJson(lesson([slide("s01"), slide("s02")], [narr("s01")])).ok,
    "count mismatch must fail",
  );
  assert.ok(
    !parseLessonJson(lesson([slide("s01")], [narr("s09")])).ok,
    "narration for a missing slide must fail",
  );
  assert.ok(
    !parseLessonJson(lesson([slide("s01"), slide("s02")], [narr("s01"), narr("s01")])).ok,
    "two narrations for one slide must fail",
  );
});

test("§4 failure names the offending slide, not just 'a slide'", () => {
  const result = parseLessonJson(lesson([slide("s01")], [narr("s09")]));
  assert.ok(result.errorText.includes("s09"));
});

test("§6.2 fence stripping survives prose and Arabic braces", () => {
  assert.equal(stripJsonFences('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripJsonFences('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripJsonFences('Here you go:\n{"a":1}'), '{"a":1}');
  // A brace inside an Arabic string must not truncate the parse.
  assert.equal(stripJsonFences('{"a":"نص { مع قوس"}'), '{"a":"نص { مع قوس"}');
});

test("§6.3 reorder moves narration and quiz refs with their slide", () => {
  const parsed = parseLessonJson(
    lesson(
      [slide("s05"), slide("s02")],
      [narr("s02", "ثاني"), narr("s05", "أول")],
      [
        {
          id: "q1",
          type: "mcq",
          question_ar: "سؤال",
          options_ar: ["أ", "ب", "ج", "د"],
          answer_index: 0,
          explanation_ar: "شرح",
          bloom: "apply",
          slide_ref: "s02",
        },
      ],
    ),
  );
  assert.ok(parsed.ok, parsed.errorText);

  const out = renumberSlides(parsed.lesson);
  assert.deepEqual(
    out.slides.map((s) => s.id),
    ["s01", "s02"],
  );
  // The slide that was s05 is now s01, and its narration came with it.
  assert.equal(out.narration[0].slide_id, "s01");
  assert.equal(out.narration[0].text_raw, "أول");
  assert.equal(out.quiz[0].slide_ref, "s02");
  assert.ok(parseLessonJson(JSON.stringify(out)).ok, "renumbered lesson must still satisfy §4");
});

test("§10 session tokens reject tampering, wrong secrets and expiry", () => {
  const payload = { uid: UID, email: "a@b.com", role: "admin" };
  const token = createSessionToken(payload, SECRET);

  assert.equal(verifySessionToken(token, SECRET)?.role, "admin");
  assert.equal(verifySessionToken(token, "y".repeat(40)), null, "wrong secret");
  assert.equal(verifySessionToken(token.replace(/.$/, "z"), SECRET), null, "tampered signature");
  assert.equal(verifySessionToken(createSessionToken(payload, SECRET, -10), SECRET), null, "expired");
});

test("§6.8 signed URLs reject forgery, expiry and path traversal", () => {
  const signed = signKey("lessons/a/deck.pdf", SECRET, 3600);
  assert.ok(verifySignedKey(signed, SECRET));
  assert.ok(!verifySignedKey({ ...signed, sig: "forged" }, SECRET));
  assert.ok(!verifySignedKey(signKey("k", SECRET, -10), SECRET));
  assert.throws(() => assertSafeKey("lessons/../../etc/passwd"));
});

test("§10 argon2id hashing round-trips and fails closed", async () => {
  const hash = await hashPassword("correct-horse-battery");
  assert.ok(await verifyPassword(hash, "correct-horse-battery"));
  assert.ok(!(await verifyPassword(hash, "wrong-horse-battery")));
  // A malformed hash must read as "wrong password", never throw.
  assert.ok(!(await verifyPassword("not-a-hash", "x")));
  await assert.rejects(() => hashPassword("short"));
});
