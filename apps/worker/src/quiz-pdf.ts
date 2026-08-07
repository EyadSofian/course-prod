import type { LessonJson } from "@course-prod/core/schema";

/**
 * Printable quiz sheet (§6.8), rendered as HTML and printed by the headless
 * browser (see media.ts:htmlToPdf).
 *
 * A PDF library would need Arabic shaping, bidi reordering and an embedded
 * Arabic font configured by hand. Chromium does all three correctly and is
 * already in the image, so the only thing this file has to get right is the
 * markup.
 */

const BLOOM_AR: Record<string, string> = {
  remember: "تذكّر",
  understand: "فهم",
  apply: "تطبيق",
  analyze: "تحليل",
  evaluate: "تقييم",
  create: "إنشاء",
};

const OPTION_LABELS = ["أ", "ب", "ج", "د"];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface QuizPdfOptions {
  /** Answer key is a separate page so the sheet can be handed out as-is. */
  includeAnswers?: boolean;
  courseTitle?: string;
}

export function renderQuizHtml(lesson: LessonJson, opts: QuizPdfOptions = {}): string {
  const { includeAnswers = true, courseTitle = "" } = opts;

  const questions = lesson.quiz
    .map(
      (q, i) => `
      <li class="q">
        <div class="qhead">
          <span class="qtext">${escapeHtml(q.question_ar)}</span>
          <span class="meta">${escapeHtml(BLOOM_AR[q.bloom] ?? q.bloom)} · <span class="ltr">${escapeHtml(q.slide_ref)}</span></span>
        </div>
        <ol class="opts">
          ${q.options_ar
            .map(
              (opt, oi) =>
                `<li><span class="lbl">${OPTION_LABELS[oi] ?? String(oi + 1)}</span> ${escapeHtml(opt)}</li>`,
            )
            .join("")}
        </ol>
      </li>`,
    )
    .join("");

  const answerKey = includeAnswers
    ? `
    <section class="answers">
      <h2>مفتاح الإجابات</h2>
      <ol>
        ${lesson.quiz
          .map(
            (q) =>
              `<li><strong>${escapeHtml(OPTION_LABELS[q.answer_index] ?? "")}</strong> — ${escapeHtml(q.explanation_ar)}</li>`,
          )
          .join("")}
      </ol>
    </section>`
    : "";

  // Self-contained: no external fonts or stylesheets, because the print
  // happens with setContent and has no network origin to resolve them against.
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(lesson.title_ar)} — الأسئلة</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "KacstOne", sans-serif;
    color: #0D2137;
    line-height: 1.8;
    font-size: 12pt;
    margin: 0;
  }
  header { border-bottom: 2px solid #0B7A8C; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .sub { color: #5B6B78; font-size: 10pt; }
  ol.qs { list-style: decimal; padding-inline-start: 22px; margin: 0; }
  li.q { margin-block-end: 16px; break-inside: avoid; }
  .qhead { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .qtext { font-weight: 600; }
  .meta { color: #5B6B78; font-size: 9pt; white-space: nowrap; }
  ol.opts { list-style: none; padding-inline-start: 0; margin: 6px 0 0; }
  ol.opts li { margin-block-end: 3px; }
  .lbl {
    display: inline-block; min-width: 20px; font-weight: 700; color: #0B7A8C;
  }
  .answers { margin-block-start: 28px; break-before: page; }
  .answers h2 { font-size: 13pt; border-bottom: 1px solid #DDE5E9; padding-bottom: 6px; }
  .answers ol { padding-inline-start: 22px; }
  /* Latin ids and numbers inside Arabic text need bidi isolation or the
     surrounding punctuation renders on the wrong side. */
  .ltr { unicode-bidi: isolate; direction: ltr; display: inline-block; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(lesson.title_ar)}</h1>
    <div class="sub">${escapeHtml(courseTitle)}${courseTitle ? " · " : ""}${lesson.quiz.length} سؤال</div>
  </header>
  <ol class="qs">${questions}</ol>
  ${answerKey}
</body>
</html>`;
}
