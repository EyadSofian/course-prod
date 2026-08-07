import Link from "next/link";
import { formatUsd } from "@course-prod/core/settings";
import { loadSettings } from "@course-prod/core/settings-store";
import { budgetWarning, monthlySpend } from "@course-prod/core/costs";
import { STAGES, type Stage } from "@course-prod/core/stages";
import { getDb, lessons as lessonsTable, courses, type Lesson } from "@course-prod/core/db";
import { desc, eq } from "drizzle-orm";
import { COLUMNS, board, relativeTime, statusLabel, lessons as pluralLessons } from "@/lib/strings";
import { JourneyBar, JourneyTrack, positionOf } from "./journey";

export const dynamic = "force-dynamic";

type Row = { lesson: Lesson; courseTitle: string | null; courseCode: string | null };

function LessonCard({ row }: { row: Row }) {
  const { lesson } = row;
  const failed = lesson.status === "FAILED";
  const blocked = lesson.status === "BLOCKED_BUDGET";
  const needsReview = lesson.status === "SUMMARIZED";

  return (
    <Link
      href={needsReview ? `/lessons/${lesson.id}/review` : `/lessons/${lesson.id}`}
      className="lesson-card"
      data-state={failed ? "failed" : blocked ? "blocked" : needsReview ? "gate" : undefined}
    >
      <div className="lesson-card-top">
        <span className="lesson-title">{lesson.titleAr}</span>
        {lesson.costCents > 0 ? (
          <span className="lesson-cost num">{formatUsd(lesson.costCents)}</span>
        ) : null}
      </div>

      <div className="lesson-course muted">
        {row.courseTitle ?? "بدون كورس"}
        {row.courseCode ? <> · <span className="ltr">{row.courseCode}</span></> : null}
      </div>

      <JourneyTrack status={lesson.status} failed={failed} />

      <div className="lesson-card-bottom">
        <span className="lesson-status" data-state={failed ? "failed" : blocked ? "blocked" : needsReview ? "gate" : undefined}>
          {statusLabel[lesson.status]}
        </span>
        <span className="muted">{relativeTime(lesson.updatedAt)}</span>
      </div>

      {lesson.error ? <div className="lesson-error">{lesson.error}</div> : null}
    </Link>
  );
}

export default async function BoardPage() {
  const db = getDb();
  const [rows, settings, spend] = await Promise.all([
    db
      .select({ lesson: lessonsTable, courseTitle: courses.titleAr, courseCode: courses.code })
      .from(lessonsTable)
      .leftJoin(courses, eq(lessonsTable.courseId, courses.id))
      .orderBy(desc(lessonsTable.updatedAt))
      .limit(300),
    loadSettings(),
    monthlySpend(),
  ]);

  // How many lessons sit at each step of the path, for the funnel counts.
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const row of rows) {
    const at = positionOf(row.lesson.status);
    const stage = STAGES[Math.min(at, STAGES.length - 1)];
    if (stage && row.lesson.status !== "PUBLISHED") counts[stage] += 1;
  }

  const awaitingReview = rows.filter((r) => r.lesson.status === "SUMMARIZED").length;
  const stopped = rows.filter(
    (r) => r.lesson.status === "FAILED" || r.lesson.status === "BLOCKED_BUDGET",
  );
  const warning = budgetWarning(spend, settings);
  const capCents = Math.round(settings.monthlyBudgetUsd * 100);
  const spentPercent = capCents > 0 ? Math.min(100, Math.round((spend.totalCents / capCents) * 100)) : 0;

  if (rows.length === 0) {
    return (
      <>
        <div className="hero">
          <div>
            <h1 className="hero-title">لوحة الإنتاج</h1>
            <p className="hero-sub">
              من المادة العلمية إلى حزمة درس كاملة — عرض تقديمي، سرد، فيديو، وأسئلة.
            </p>
          </div>
          <Link href="/lessons/new" className="btn btn-primary btn-lg">
            {board.emptyCta}
          </Link>
        </div>

        <JourneyBar counts={counts} awaitingReview={0} />

        <div className="empty-state">
          <span className="empty-mark" aria-hidden>◫</span>
          <h2>لا توجد دروس بعد</h2>
          <p className="muted">ارفع أول مادة علمية لبدء خط الإنتاج.</p>
          <Link href="/lessons/new" className="btn btn-primary">
            {board.emptyCta}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="hero">
        <div>
          <h1 className="hero-title">لوحة الإنتاج</h1>
          <p className="hero-sub">
            {pluralLessons(rows.length)} · مصروف الشهر{" "}
            <span className="num">{formatUsd(spend.totalCents)}</span> من{" "}
            <span className="num">{formatUsd(capCents)}</span>
          </p>
          <div className="budget-bar" aria-label={`استُهلك ${spentPercent}% من الميزانية`}>
            <span style={{ inlineSize: `${spentPercent}%` }} data-warn={spentPercent >= settings.budgetWarnPercent} />
          </div>
        </div>
        <Link href="/lessons/new" className="btn btn-primary btn-lg">
          {board.emptyCta}
        </Link>
      </div>

      {warning ? (
        <div className="alert alert-warn" style={{ marginBlockEnd: 16 }} role="status">
          {warning}
        </div>
      ) : null}

      <JourneyBar counts={counts} awaitingReview={awaitingReview} />

      {awaitingReview > 0 ? (
        <section className="gate-panel">
          <div className="gate-head">
            <h2>بانتظار مراجعتك</h2>
            <span className="muted">
              لا شيء يتقدّم تلقائياً بعد هذه النقطة — الدرس يقف هنا حتى تعتمده.
            </span>
          </div>
          <div className="lesson-grid">
            {rows
              .filter((r) => r.lesson.status === "SUMMARIZED")
              .map((r) => (
                <LessonCard key={r.lesson.id} row={r} />
              ))}
          </div>
        </section>
      ) : null}

      {stopped.length > 0 ? (
        <section className="stopped-panel">
          <div className="gate-head">
            <h2>متوقف</h2>
            <span className="muted">{stopped.length} درس يحتاج تدخّلاً</span>
          </div>
          <div className="lesson-grid">
            {stopped.map((r) => (
              <LessonCard key={r.lesson.id} row={r} />
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ marginBlockStart: 28 }}>
        <div className="gate-head">
          <h2>كل الدروس</h2>
        </div>
        <div className="board">
          {COLUMNS.map((col) => {
            const items = rows.filter((r) => col.statuses.includes(r.lesson.status));
            if (items.length === 0) return null;
            return (
              <section
                key={col.id}
                className="board-col"
                data-gate={col.gate ? "true" : undefined}
                data-stopped={col.stopped ? "true" : undefined}
              >
                <header>
                  <span>{col.label}</span>
                  <span className="num">{items.length}</span>
                </header>
                {items.map((r) => (
                  <LessonCard key={r.lesson.id} row={r} />
                ))}
              </section>
            );
          })}
        </div>
      </section>
    </>
  );
}
