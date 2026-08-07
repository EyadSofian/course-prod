import Link from "next/link";
import { notFound } from "next/navigation";
import type { Stage } from "@course-prod/core/stages";
import { formatUsd } from "@course-prod/core/settings";
import { loadSettings } from "@course-prod/core/settings-store";
import { lessonCostBreakdown, monthlySpend } from "@course-prod/core/costs";
import { signKey } from "@course-prod/core/storage";
import { getAssets, getLesson, getStageRuns } from "@/lib/queries";
import { PIPELINE, nextAction, rankOf, stepStates } from "@/lib/pipeline";
import { cost as costCopy, relativeTime, slides as pluralSlides, statusLabel } from "@/lib/strings";
import { runStage } from "../../actions";
import { DokieQuestion } from "./dokie-question";
import { StepPanel, type RunSummary } from "./step-panel";

export const dynamic = "force-dynamic";

const ASSET_LABEL: Record<string, string> = {
  deck_pptx: "العرض (PPTX)",
  deck_pdf: "العرض (PDF)",
  slide_png: "صور الشرائح",
  audio_mp3: "المقاطع الصوتية",
  audio_merged_mp3: "الصوت المدمج (MP3)",
  lesson_mp4: "الفيديو (MP4)",
  srt: "الترجمة (SRT)",
  quiz_pdf: "الأسئلة (PDF)",
  package_zip: "الحزمة الكاملة (ZIP)",
  source_file: "الملف المصدر",
  source_text: "النص المستخرج",
};

function signedUrl(key: string, publicUrl: string, secret: string): string {
  const { expires, sig } = signKey(key, secret, 24 * 60 * 60);
  const u = new URL("/api/files", publicUrl);
  u.searchParams.set("key", key);
  u.searchParams.set("expires", String(expires));
  u.searchParams.set("sig", sig);
  return u.toString();
}

/**
 * The lesson workspace.
 *
 * Rebuilt around one question: what does this producer do next. That answer
 * (lib/pipeline.ts) is stated once at the top, and the step that needs them is
 * the only one expanded — the previous version gave all seven stages identical
 * rows and left them to work it out, which is why the approval gate was
 * invisible and a stopped lesson looked unrecoverable.
 */
export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getLesson(id);
  if (!row) notFound();

  const { lesson } = row;
  const [runs, assetRows, settings, breakdown, spend] = await Promise.all([
    getStageRuns(id),
    getAssets(id),
    loadSettings(),
    lessonCostBreakdown(id),
    monthlySpend(),
  ]);

  const secret = process.env.SESSION_SECRET ?? "";
  const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";
  const costByStage = new Map(breakdown.map((b) => [b.stage, b.costCents]));

  const latestByStage = new Map<Stage, RunSummary>();
  for (const run of runs) {
    if (!latestByStage.has(run.stage as Stage)) latestByStage.set(run.stage as Stage, run as RunSummary);
  }

  const stopped = lesson.status === "FAILED" || lesson.status === "BLOCKED_BUDGET";

  // Which step stopped the lesson. Derived from the runs rather than the
  // status, because FAILED erases the position the lesson had reached.
  const stoppedAtIndex = stopped
    ? PIPELINE.findIndex(
        (s) => s.kind === "stage" && latestByStage.get(s.id as Stage)?.status !== "succeeded" &&
          latestByStage.get(s.id as Stage) !== undefined,
      )
    : null;

  const states = stepStates(lesson.status, stoppedAtIndex === -1 ? null : stoppedAtIndex);
  const action = nextAction(lesson);
  const rank = rankOf(lesson.status);

  const grouped = new Map<string, { count: number; bytes: number; key: string }>();
  for (const a of assetRows) {
    const g = grouped.get(a.kind) ?? { count: 0, bytes: 0, key: a.storageKey };
    grouped.set(a.kind, { count: g.count + 1, bytes: g.bytes + a.bytes, key: g.key });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/" className="back-link">← لوحة الإنتاج</Link>
          <h1 style={{ marginBlockStart: 6 }}>{lesson.titleAr}</h1>
          <div className="muted">
            {row.courseTitle} · <span className="ltr">{row.courseCode}</span> · {row.market} ·{" "}
            {lesson.lessonJson ? pluralSlides(lesson.lessonJson.slides.length) : "لم تُهيكل بعد"} ·{" "}
            {relativeTime(lesson.updatedAt)}
          </div>
        </div>
        <span className="chip">{statusLabel[lesson.status]}</span>
      </div>

      {/* The single next action. Everything below is detail; this is the
          instruction, and it is never more than one thing. */}
      <section className="next-action" data-tone={action.tone}>
        <div>
          <span className="next-label">الخطوة التالية</span>
          <h2>{action.label}</h2>
          <p className="muted" style={{ margin: "3px 0 0" }}>{action.why}</p>
        </div>
        {action.href ? (
          <Link href={action.href} className="btn btn-primary btn-lg">{action.label}</Link>
        ) : action.stage ? (
          <form action={runStage}>
            <input type="hidden" name="lessonId" value={id} />
            <input type="hidden" name="stage" value={action.stage} />
            {stopped ? <input type="hidden" name="force" value="1" /> : null}
            <button type="submit" className="btn btn-primary btn-lg">{action.label}</button>
          </form>
        ) : null}
      </section>

      {lesson.dokiePendingQuestion ? (
        <DokieQuestion lessonId={id} question={lesson.dokiePendingQuestion} />
      ) : null}

      {lesson.error && !lesson.dokiePendingQuestion ? (
        <div
          className={lesson.status === "BLOCKED_BUDGET" ? "alert alert-warn" : "alert alert-error"}
          style={{ marginBlockEnd: 16 }}
          role="alert"
        >
          <strong>{lesson.status === "BLOCKED_BUDGET" ? "موقوف: تجاوز الميزانية" : "سبب التعثّر"}</strong>
          <div style={{ marginBlockStart: 4 }}>{lesson.error}</div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0,1fr) 300px" }}>
        <section>
          <div className="gate-head"><h2>خط الإنتاج</h2></div>
          <div className="steps">
            {PIPELINE.map((step, i) => {
              const stage = step.kind === "stage" ? (step.id as Stage) : null;
              const run = stage ? (latestByStage.get(stage) ?? null) : null;
              const state = states[i]!;

              // The gate is not a queue job: it is a link to the editor.
              if (step.kind === "gate") {
                return (
                  <div key={step.id} className="step" data-state={state} data-open={state === "current"}>
                    <div className="step-head">
                      <span className="step-icon" aria-hidden>{state === "done" ? "✓" : step.icon}</span>
                      <div className="step-title">
                        <span className="step-name">{step.label}</span>
                        <span className="step-meta">
                          {state === "done" ? "معتمَد" : state === "current" ? step.hint : "لم يبدأ"}
                        </span>
                      </div>
                    </div>
                    {state === "current" || state === "done" ? (
                      <div className="step-body">
                        <div className="step-actions">
                          <Link href={`/lessons/${id}/review`} className="btn btn-primary">
                            {state === "done" ? "فتح المراجعة" : "راجع واعتمد"}
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
                <StepPanel
                  key={step.id}
                  step={step}
                  state={state}
                  run={run}
                  costCents={costByStage.get(stage!) ?? 0}
                  lessonId={id}
                  isCurrent={state === "current"}
                  canRun={rank === i || state === "stopped"}
                  recover={state === "stopped"}
                  runStage={runStage}
                />
              );
            })}
          </div>
        </section>

        <aside style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card">
            <h2 style={{ marginBlockEnd: 10 }}>{costCopy.panel}</h2>
            <dl className="kv">
              {breakdown.length === 0 ? (
                <div className="muted">لا تكلفة بعد.</div>
              ) : (
                breakdown.map((b) => (
                  <div key={b.stage}>
                    <dt>{PIPELINE.find((s) => s.id === b.stage)?.label ?? b.stage}</dt>
                    <dd className="num">{b.costCents === 0 ? costCopy.free : formatUsd(b.costCents)}</dd>
                  </div>
                ))
              )}
              <div className="total">
                <dt>{costCopy.lessonTotal}</dt>
                <dd className="num">{formatUsd(lesson.costCents)}</dd>
              </div>
            </dl>
            <p className="muted" style={{ marginBlockEnd: 0 }}>
              {costCopy.monthly(formatUsd(spend.totalCents), formatUsd(settings.monthlyBudgetUsd * 100))}
            </p>
            <p className="dim" style={{ marginBlockStart: 4, marginBlockEnd: 0 }}>
              {costCopy.dokieFootnote}
            </p>
          </div>

          <div className="card">
            <h2 style={{ marginBlockEnd: 10 }}>الملفات</h2>
            {grouped.size === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                تظهر هنا بعد توليد العرض.
              </p>
            ) : (
              <>
                <ul className="files">
                  {[...grouped.entries()].map(([kind, g]) => (
                    <li key={kind}>
                      <a href={signedUrl(g.key, publicUrl, secret)}>
                        {ASSET_LABEL[kind] ?? kind}
                        {g.count > 1 ? ` (${g.count})` : ""}
                      </a>
                      <span className="muted num">{(g.bytes / 1024 / 1024).toFixed(1)} MB</span>
                    </li>
                  ))}
                </ul>
                <p className="dim" style={{ marginBlockEnd: 0 }}>الروابط صالحة 24 ساعة.</p>
              </>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginBlockEnd: 8 }}>المصدر</h2>
            <p className="muted" style={{ margin: 0 }}>
              {lesson.sourceCharCount
                ? `${lesson.sourceCharCount.toLocaleString("en-US")} حرف مستخرج`
                : "لم يُستخرج النص بعد"}
            </p>
            {lesson.dokieProjectUrl ? (
              <p style={{ marginBlockEnd: 0, marginBlockStart: 8 }}>
                <a href={lesson.dokieProjectUrl} target="_blank" rel="noreferrer">
                  فتح المشروع في Dokie ↗
                </a>
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </>
  );
}
