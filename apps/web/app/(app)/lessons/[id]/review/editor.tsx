"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import type { LessonJson } from "@course-prod/core/schema";
import {
  MAX_BULLETS_PER_SLIDE,
  MAX_TITLE_WORDS,
  MAX_WORDS_PER_BULLET,
} from "@course-prod/core/schema";
import { approveLesson, saveLessonJson, type ActionState } from "../../../actions";
import { questions as pluralQuestions, slides as pluralSlides } from "@/lib/strings";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Arabic combining diacritics — every one is a billed character (§6.6). */
const TASHKEEL = /[ً-ْٰٓ-ٕ]/gu;

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-secondary" disabled={pending}>
      {pending ? "جارٍ الحفظ…" : label}
    </button>
  );
}

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "جارٍ الاعتماد…" : "اعتماد الدرس"}
    </button>
  );
}

export function ReviewEditor({
  lessonId,
  titleAr,
  courseTitle,
  status,
  version,
  sourceText,
  lessonJson,
}: {
  lessonId: string;
  titleAr: string;
  courseTitle: string;
  status: string;
  version: number;
  sourceText: string;
  lessonJson: LessonJson;
}) {
  const [draft, setDraft] = useState<LessonJson>(lessonJson);
  const [dirty, setDirty] = useState(false);
  const [saveState, saveAction] = useActionState<ActionState, FormData>(saveLessonJson, {});
  const [approveState, approveAction] = useActionState<ActionState, FormData>(approveLesson, {});

  const update = (next: LessonJson) => {
    setDraft(next);
    setDirty(true);
  };

  /**
   * Validation mirrors the zod schema (§14 rules) but runs per-field so a
   * producer sees which bullet is too long, rather than a single rejection
   * when they hit approve.
   */
  const issues = useMemo(() => validate(draft), [draft]);

  const moveSlide = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draft.slides.length) return;

    const slides = [...draft.slides];
    const [moved] = slides.splice(index, 1);
    slides.splice(target, 0, moved!);

    // Renumber slides and carry narration + quiz refs with them (§6.3). The
    // mapping is derived from old id → new id, never from position, so a
    // reorder can never desynchronise audio from slides (§13).
    const remap = new Map<string, string>();
    const renumbered = slides.map((slide, i) => {
      const nextId = `s${String(i + 1).padStart(2, "0")}`;
      remap.set(slide.id, nextId);
      return { ...slide, id: nextId };
    });

    const byOldId = new Map(draft.narration.map((n) => [n.slide_id, n]));
    const narration = slides.flatMap((slide) => {
      const entry = byOldId.get(slide.id);
      return entry ? [{ ...entry, slide_id: remap.get(slide.id)! }] : [];
    });

    const quiz = draft.quiz.map((q) => ({ ...q, slide_ref: remap.get(q.slide_ref) ?? q.slide_ref }));

    update({ ...draft, slides: renumbered, narration, quiz });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>مراجعة: {titleAr}</h1>
          <div className="muted">
            {courseTitle} · {pluralSlides(draft.slides.length)} ·{" "}
            {pluralQuestions(draft.quiz.length)}
            {version > 1 ? ` · نسخة ${version}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dirty ? <span className="chip" style={{ color: "#B45309" }}>تعديلات غير محفوظة</span> : null}

          <form action={saveAction}>
            <input type="hidden" name="lessonId" value={lessonId} />
            <input type="hidden" name="lessonJson" value={JSON.stringify(draft)} />
            <SaveButton label="حفظ المسودة" />
          </form>

          <form action={approveAction}>
            <input type="hidden" name="lessonId" value={lessonId} />
            <ApproveButton />
          </form>
        </div>
      </div>

      {saveState.error || approveState.error ? (
        <div className="alert alert-error" style={{ marginBlockEnd: 12 }} role="alert">
          {saveState.error ?? approveState.error}
        </div>
      ) : null}
      {saveState.ok ? (
        <div className="alert alert-ok" style={{ marginBlockEnd: 12 }} role="status">
          {saveState.ok}
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="alert alert-warn" style={{ marginBlockEnd: 12 }} role="status">
          <strong>{issues.length} ملاحظة على المحتوى</strong>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
            {issues.slice(0, 6).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="muted" style={{ marginBlockStart: 0 }}>
        الاعتماد يجمّد هذه النسخة ويسمح ببدء الإنتاج. لا شيء يعمل تلقائياً قبله.
        {status === "REVIEWED" ? " هذا الدرس معتمَد بالفعل؛ الحفظ ينشئ نسخة جديدة." : ""}
      </p>

      <div className="review-split">
        <section className="card review-pane">
          <h2>
            النص المصدر <span className="muted num">({sourceText.length.toLocaleString("en-US")} حرف)</span>
          </h2>
          <div className="source-text">{sourceText || "لا يوجد نص مصدر."}</div>
        </section>

        <section className="card review-pane">
          <h2>الدرس المُهيكل</h2>

          <div className="field">
            <label htmlFor="lesson-title">العنوان</label>
            <input
              id="lesson-title"
              value={draft.title_ar}
              onChange={(e) => update({ ...draft, title_ar: e.target.value })}
            />
          </div>

          <h3 style={{ marginBlockStart: 16 }}>الأهداف</h3>
          {draft.objectives.map((objective, i) => (
            <input
              key={i}
              style={{ marginBlockEnd: 6, inlineSize: "100%" }}
              value={objective}
              onChange={(e) => {
                const objectives = [...draft.objectives];
                objectives[i] = e.target.value;
                update({ ...draft, objectives });
              }}
            />
          ))}

          <h3 style={{ marginBlockStart: 16 }}>الشرائح والسرد</h3>
          {draft.slides.map((slide, i) => {
            const narration = draft.narration.find((n) => n.slide_id === slide.id);
            const tashkeelCount = (narration?.text_raw.match(TASHKEEL) ?? []).length;

            return (
              <div key={slide.id} className="slide-card">
                <div className="slide-head">
                  <span className="mono">{slide.id}</span>
                  <span className="muted">{slide.layout}</span>
                  <span style={{ marginInlineStart: "auto", display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => moveSlide(i, -1)}
                      disabled={i === 0}
                      aria-label={`نقل ${slide.id} لأعلى`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => moveSlide(i, 1)}
                      disabled={i === draft.slides.length - 1}
                      aria-label={`نقل ${slide.id} لأسفل`}
                    >
                      ↓
                    </button>
                  </span>
                </div>

                <input
                  value={slide.title_ar}
                  onChange={(e) => {
                    const slides = [...draft.slides];
                    slides[i] = { ...slide, title_ar: e.target.value };
                    update({ ...draft, slides });
                  }}
                />
                {words(slide.title_ar) > MAX_TITLE_WORDS ? (
                  <span className="inline-warn">
                    العنوان {words(slide.title_ar)} كلمة، والحد {MAX_TITLE_WORDS}.
                  </span>
                ) : null}

                {slide.bullets.map((bullet, bi) => (
                  <div key={bi}>
                    <input
                      style={{ marginBlockStart: 4, inlineSize: "100%" }}
                      value={bullet}
                      onChange={(e) => {
                        const slides = [...draft.slides];
                        const bullets = [...slide.bullets];
                        bullets[bi] = e.target.value;
                        slides[i] = { ...slide, bullets };
                        update({ ...draft, slides });
                      }}
                    />
                    {words(bullet) > MAX_WORDS_PER_BULLET ? (
                      <span className="inline-warn">
                        النقطة {words(bullet)} كلمة، والحد {MAX_WORDS_PER_BULLET}.
                      </span>
                    ) : null}
                  </div>
                ))}
                {slide.bullets.length > MAX_BULLETS_PER_SLIDE ? (
                  <span className="inline-warn">
                    الشريحة بها {slide.bullets.length} نقاط، والحد {MAX_BULLETS_PER_SLIDE}.
                  </span>
                ) : null}

                <label className="narration-label">السرد</label>
                {narration ? (
                  <>
                    <textarea
                      rows={4}
                      value={narration.text_raw}
                      onChange={(e) => {
                        const narrationList = draft.narration.map((n) =>
                          n.slide_id === slide.id
                            ? { ...n, text_raw: e.target.value, est_chars: e.target.value.length }
                            : n,
                        );
                        update({ ...draft, narration: narrationList });
                      }}
                    />
                    <span className="muted num">{narration.text_raw.length} حرف</span>
                    {tashkeelCount > 0 ? (
                      <span className="inline-warn">
                        هذا السرد يحتوي {tashkeelCount} علامة تشكيل. التشكيل يُطبَّق من قاموس النطق،
                        لا من هنا — وكل علامة حرف مفوتر.
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="inline-warn">لا يوجد سرد لهذه الشريحة.</span>
                )}
              </div>
            );
          })}

          <h3 style={{ marginBlockStart: 16 }}>الأسئلة</h3>
          {draft.quiz.map((q, qi) => (
            <div key={q.id} className="slide-card">
              <div className="slide-head">
                <span className="mono">{q.id}</span>
                <span className="muted">
                  {q.bloom} · <span className="mono">{q.slide_ref}</span>
                </span>
              </div>
              <input
                value={q.question_ar}
                onChange={(e) => {
                  const quiz = [...draft.quiz];
                  quiz[qi] = { ...q, question_ar: e.target.value };
                  update({ ...draft, quiz });
                }}
              />
              {q.options_ar.map((opt, oi) => (
                <div key={oi} style={{ display: "flex", gap: 6, alignItems: "center", marginBlockStart: 4 }}>
                  <input
                    type="radio"
                    name={`answer-${q.id}`}
                    checked={q.answer_index === oi}
                    onChange={() => {
                      const quiz = [...draft.quiz];
                      quiz[qi] = { ...q, answer_index: oi };
                      update({ ...draft, quiz });
                    }}
                    aria-label={`الإجابة الصحيحة للخيار ${oi + 1}`}
                  />
                  <input
                    style={{ flex: 1 }}
                    value={opt}
                    onChange={(e) => {
                      const quiz = [...draft.quiz];
                      const options = [...q.options_ar];
                      options[oi] = e.target.value;
                      quiz[qi] = { ...q, options_ar: options };
                      update({ ...draft, quiz });
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function validate(lesson: LessonJson): string[] {
  const issues: string[] = [];
  const slideIds = new Set(lesson.slides.map((s) => s.id));

  if (lesson.narration.length !== lesson.slides.length) {
    issues.push(
      `عدد نصوص السرد لا يطابق عدد الشرائح — ${lesson.narration.length} سرد مقابل ${lesson.slides.length} شريحة.`,
    );
  }
  for (const slide of lesson.slides) {
    if (!lesson.narration.some((n) => n.slide_id === slide.id)) {
      issues.push(`لا يوجد سرد للشريحة ${slide.id}.`);
    }
  }
  for (const n of lesson.narration) {
    if (!slideIds.has(n.slide_id)) issues.push(`السرد يشير إلى شريحة غير موجودة: ${n.slide_id}.`);
  }
  for (const q of lesson.quiz) {
    if (!slideIds.has(q.slide_ref)) {
      issues.push(`السؤال ${q.id} يشير إلى شريحة محذوفة (${q.slide_ref}).`);
    }
  }
  return issues;
}
