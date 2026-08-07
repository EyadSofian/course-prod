import Link from "next/link";
import { desc } from "drizzle-orm";
import { formatUsd, getDb, lessons as lessonsTable, type Lesson } from "@course-prod/core";
import { COLUMNS, board, relativeTime, statusLabel, lessons as pluralLessons } from "@/lib/strings";

export const dynamic = "force-dynamic";

function LessonCard({ lesson }: { lesson: Lesson }) {
  return (
    <Link
      href={`/lessons/${lesson.id}`}
      className="card"
      style={{
        display: "block",
        marginBlockEnd: 8,
        textDecoration: "none",
        color: "inherit",
        padding: 12,
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 14, marginBlockEnd: 6 }}>{lesson.titleAr}</div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="chip">{statusLabel[lesson.status]}</span>
        {lesson.costCents > 0 ? (
          <span className="chip num">{formatUsd(lesson.costCents)}</span>
        ) : null}
      </div>

      <div className="muted" style={{ marginBlockStart: 6, fontSize: 12 }}>
        {board.lastUpdated}: {relativeTime(lesson.updatedAt)}
      </div>
    </Link>
  );
}

export default async function BoardPage() {
  const db = getDb();
  const all = await db.select().from(lessonsTable).orderBy(desc(lessonsTable.updatedAt)).limit(300);

  return (
    <>
      <div className="page-head">
        <h1>{board.title}</h1>
        <span className="muted">{all.length > 0 ? pluralLessons(all.length) : null}</span>
      </div>

      {all.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ marginBlockStart: 0 }}>{board.empty}</p>
          <Link href="/lessons/new" className="btn btn-primary" style={{ textDecoration: "none" }}>
            {board.emptyCta}
          </Link>
        </div>
      ) : (
        <div className="board">
          {COLUMNS.map((col) => {
            const items = all.filter((l) => col.statuses.includes(l.status));
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
                {items.map((l) => (
                  <LessonCard key={l.id} lesson={l} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
