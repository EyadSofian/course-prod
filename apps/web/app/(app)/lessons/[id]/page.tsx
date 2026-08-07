import Link from "next/link";
import { notFound } from "next/navigation";
import { STAGES, STAGE_SPEC, type Stage } from "@course-prod/core/stages";
import { formatUsd } from "@course-prod/core/settings";
import { loadSettings } from "@course-prod/core/settings-store";
import { lessonCostBreakdown, monthlySpend, budgetWarning } from "@course-prod/core/costs";
import { signKey } from "@course-prod/core/storage";
import { getAssets, getLesson, getStageRuns } from "@/lib/queries";
import { cost as costCopy, relativeTime, slides as pluralSlides, stageLabel, statusLabel } from "@/lib/strings";
import { runStage } from "../../actions";
import { DokieQuestion } from "./dokie-question";
import { StageRow } from "./stage-row";

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
  const latestByStage = new Map<Stage, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latestByStage.has(run.stage as Stage)) latestByStage.set(run.stage as Stage, run);
  }

  // Group per-slide assets so 18 PNGs are one row, not eighteen.
  const grouped = new Map<string, { count: number; bytes: number; key: string }>();
  for (const a of assetRows) {
    const g = grouped.get(a.kind) ?? { count: 0, bytes: 0, key: a.storageKey };
    grouped.set(a.kind, { count: g.count + 1, bytes: g.bytes + a.bytes, key: g.key });
  }

  // A stopped lesson can never match a stage's entry status again, so the
  // retry path has to be reopened explicitly.
  const stopped = lesson.status === "FAILED" || lesson.status === "BLOCKED_BUDGET";
  const warning = budgetWarning(spend, settings);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{lesson.titleAr}</h1>
          <div className="muted">
            {row.courseTitle} · <span className="ltr">{row.courseCode}</span> · {row.market} ·{" "}
            {lesson.lessonJson ? pluralSlides(lesson.lessonJson.slides.length) : "لم تُهيكل بعد"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="chip">{statusLabel[lesson.status]}</span>
          {lesson.status === "SUMMARIZED" ? (
            <Link href={`/lessons/${id}/review`} className="btn btn-primary" style={{ textDecoration: "none" }}>
              فتح المراجعة
            </Link>
          ) : null}
        </div>
      </div>

      {lesson.dokiePendingQuestion ? (
        <DokieQuestion lessonId={id} question={lesson.dokiePendingQuestion} />
      ) : null}

      {lesson.status === "BLOCKED_BUDGET" ? (
        <div className="alert alert-warn" style={{ marginBlockEnd: 16 }} role="status">
          <strong>موقوف: تجاوز الميزانية</strong>
          <div>{lesson.error}</div>
        </div>
      ) : lesson.error ? (
        <div className="alert alert-error" style={{ marginBlockEnd: 16 }} role="alert">
          <strong>متعثّر{lesson.currentStage ? `: ${stageLabel[lesson.currentStage]}` : ""}</strong>
          <div>{lesson.error}</div>
        </div>
      ) : null}

      {warning ? (
        <div className="alert alert-warn" style={{ marginBlockEnd: 16 }} role="status">
          {warning}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0,1fr) 300px" }}>
        <section className="card">
          <h2 style={{ marginBlockEnd: 12 }}>مراحل الإنتاج</h2>
          <div className="timeline">
            {STAGES.map((stage) => (
              <StageRow
                key={stage}
                lessonId={id}
                stage={stage}
                label={stageLabel[stage]}
                run={latestByStage.get(stage) ?? null}
                costCents={costByStage.get(stage) ?? 0}
                runnable={
                  // Normal case: the lesson sits at this stage's entry status.
                  lesson.status === STAGE_SPEC[stage].from ||
                  // Recovery case: the lesson is stopped and *this* is the
                  // stage that stopped it. Without this the retry button
                  // disappears the moment anything fails — FAILED is not any
                  // stage's `from`, so a broken lesson became unrecoverable
                  // from the UI and could only be fixed in the database.
                  (stopped && latestByStage.get(stage)?.status !== "succeeded" &&
                    latestByStage.get(stage) !== undefined)
                }
                recover={stopped}
                billable={STAGE_SPEC[stage].billable}
                busy={lesson.currentStage === stage}
                runStage={runStage}
              />
            ))}
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
                    <dt>{stageLabel[b.stage]}</dt>
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
            <p className="muted" style={{ marginBlockStart: 4, marginBlockEnd: 0, fontSize: 11 }}>
              {costCopy.dokieFootnote}
            </p>
          </div>

          <div className="card">
            <h2 style={{ marginBlockEnd: 10 }}>الملفات</h2>
            {grouped.size === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                لا توجد ملفات بعد. تظهر هنا بعد اعتماد المراجعة وتوليد العرض.
              </p>
            ) : (
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
            )}
            {grouped.size > 0 ? (
              <p className="muted" style={{ marginBlockEnd: 0, fontSize: 11 }}>
                الروابط صالحة 24 ساعة.
              </p>
            ) : null}
          </div>

          {lesson.dokieProjectUrl ? (
            <div className="card">
              <h2 style={{ marginBlockEnd: 8 }}>Dokie</h2>
              <a href={lesson.dokieProjectUrl} target="_blank" rel="noreferrer" className="ltr">
                فتح المشروع
              </a>
            </div>
          ) : null}

          <div className="card">
            <h2 style={{ marginBlockEnd: 8 }}>المصدر</h2>
            <p className="muted" style={{ margin: 0 }}>
              {lesson.sourceCharCount
                ? `${lesson.sourceCharCount.toLocaleString("en-US")} حرف مستخرج`
                : "لم يُستخرج النص بعد"}
            </p>
            <p className="muted" style={{ marginBlockEnd: 0, fontSize: 11 }}>
              آخر تحديث {relativeTime(lesson.updatedAt)}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
