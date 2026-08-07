import Link from "next/link";
import { STAGES, STAGE_SPEC, type LessonStatus, type Stage } from "@course-prod/core/stages";

/**
 * The production journey.
 *
 * The board used to be eight parallel columns, which showed *where things sit*
 * but not *where anything is going*. Production here is a single ordered path —
 * material in one end, a package out the other — and the interface should say
 * so at a glance. This renders that path once at the top of the board, and
 * again per lesson with the current position marked.
 */

/** Where each status sits on the path. -1 = not started, STAGES.length = done. */
export function positionOf(status: LessonStatus): number {
  if (status === "PUBLISHED") return STAGES.length;
  if (status === "DRAFT") return 0;
  const index = STAGES.findIndex((s) => STAGE_SPEC[s].from === status);
  return index === -1 ? 0 : index;
}

export const STEP_LABEL: Record<Stage, string> = {
  INGEST: "استخراج النص",
  SUMMARIZE: "هيكلة الدرس",
  DECK: "توليد العرض",
  EXPORT: "تصدير الملفات",
  NARRATE: "توليد السرد",
  ASSEMBLE: "تجميع الفيديو",
  PUBLISH: "نشر الحزمة",
};

const STEP_ICON: Record<Stage, string> = {
  INGEST: "◫",
  SUMMARIZE: "❖",
  DECK: "▤",
  EXPORT: "⬓",
  NARRATE: "◍",
  ASSEMBLE: "▶",
  PUBLISH: "✦",
};

/**
 * Full-width journey with a count at each step — the funnel view.
 * The review gate is marked because it is the only step that waits on a human,
 * and a lesson parked there stalls silently (§5).
 */
export function JourneyBar({
  counts,
  awaitingReview,
}: {
  counts: Record<Stage, number>;
  awaitingReview: number;
}) {
  return (
    <div className="journey" role="list" aria-label="مراحل الإنتاج">
      {STAGES.map((stage, i) => {
        const isGate = stage === "DECK"; // everything before it needs approval
        return (
          <div key={stage} className="journey-step" role="listitem">
            {i > 0 ? <span className="journey-link" aria-hidden /> : null}

            <div className="journey-node" data-busy={counts[stage] > 0}>
              <span className="journey-icon" aria-hidden>
                {STEP_ICON[stage]}
              </span>
              {counts[stage] > 0 ? (
                <span className="journey-count num">{counts[stage]}</span>
              ) : null}
            </div>

            <span className="journey-label">{STEP_LABEL[stage]}</span>
            {STAGE_SPEC[stage].billable ? (
              <span className="journey-cost" title="مرحلة مكلّفة">
                تستهلك رصيداً
              </span>
            ) : null}

            {isGate && awaitingReview > 0 ? (
              <Link href="/?filter=review" className="journey-gate">
                {awaitingReview} بانتظار المراجعة
              </Link>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Compact inline progress for a lesson card. */
export function JourneyTrack({
  status,
  failed,
}: {
  status: LessonStatus;
  failed?: boolean;
}) {
  const position = positionOf(status);

  return (
    <div className="track" aria-label={`تقدّم الدرس: ${position} من ${STAGES.length}`}>
      {STAGES.map((stage, i) => (
        <span
          key={stage}
          className="track-seg"
          data-state={
            failed && i === position ? "failed" : i < position ? "done" : i === position ? "now" : "todo"
          }
          title={STEP_LABEL[stage]}
        />
      ))}
    </div>
  );
}
