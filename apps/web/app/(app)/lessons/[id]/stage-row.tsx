"use client";

import { useState } from "react";
import { formatUsd } from "@course-prod/core/settings";
import type { Stage, StageRunStatus } from "@course-prod/core/stages";
import { actions } from "@/lib/strings";

interface Run {
  status: StageRunStatus;
  attempt: number;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  errorCode: string | null;
  log: Record<string, unknown> | null;
}

/**
 * One row of the stage timeline (§8 page 3).
 *
 * The retry/regenerate split from docs/ux-copy.ar.md is enforced structurally
 * here, not by convention: a failed stage renders `إعادة المحاولة` (free) and
 * a succeeded one renders `إعادة التوليد` (costs money, behind a confirm).
 * The two never appear together, so a producer never has to read a tooltip to
 * find out whether a click spends money.
 */
export function StageRow({
  lessonId,
  stage,
  label,
  run,
  costCents,
  runnable,
  billable,
  busy,
  runStage,
}: {
  lessonId: string;
  stage: Stage;
  label: string;
  run: Run | null;
  costCents: number;
  runnable: boolean;
  billable: boolean;
  busy: boolean;
  runStage: (formData: FormData) => Promise<void>;
}) {
  const [showLog, setShowLog] = useState(false);
  const succeeded = run?.status === "succeeded";
  const failed = run?.status === "failed";
  const blocked = run?.status === "blocked";

  const durationMs =
    run?.finishedAt && run.startedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null;

  return (
    <div className="stage" data-state={busy ? "running" : (run?.status ?? "idle")}>
      <div className="stage-main">
        <span className="stage-name">{label}</span>
        <span className="stage-meta muted">
          {busy ? (
            <>جارٍ التنفيذ…</>
          ) : run ? (
            <>
              {run.status === "succeeded" && "تم"}
              {run.status === "failed" && "متعثّر"}
              {run.status === "blocked" && "موقوف: الميزانية"}
              {run.status === "running" && "جارٍ التنفيذ…"}
              {run.attempt > 1 ? ` · المحاولة ${run.attempt}` : ""}
              {durationMs !== null ? ` · ${formatDuration(durationMs)}` : ""}
            </>
          ) : (
            "لم تُشغَّل بعد"
          )}
        </span>
      </div>

      <div className="stage-actions">
        {costCents > 0 ? <span className="chip num">{formatUsd(costCents)}</span> : null}

        {run?.log ? (
          <button type="button" className="btn btn-ghost" onClick={() => setShowLog((v) => !v)}>
            {actions.viewLog}
          </button>
        ) : null}

        {!busy && runnable && !succeeded ? (
          <form action={runStage}>
            <input type="hidden" name="lessonId" value={lessonId} />
            <input type="hidden" name="stage" value={stage} />
            <button type="submit" className="btn btn-primary">
              {failed || blocked ? actions.retry : `تشغيل`}
            </button>
          </form>
        ) : null}

        {!busy && succeeded ? (
          <RegenerateButton lessonId={lessonId} stage={stage} label={label} billable={billable} runStage={runStage} />
        ) : null}
      </div>

      {showLog && run?.log ? (
        <pre className="stage-log">{JSON.stringify(run.log, null, 2)}</pre>
      ) : null}
    </div>
  );
}

/**
 * §6.4 names accidental regeneration as the single biggest historical cost
 * leak, so every regeneration is confirmed and the confirm names the cost.
 * Free stages get a lighter confirm — friction should track real risk, or
 * people learn to click through it.
 */
function RegenerateButton({
  lessonId,
  stage,
  label,
  billable,
  runStage,
}: {
  lessonId: string;
  stage: Stage;
  label: string;
  billable: boolean;
  runStage: (formData: FormData) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
        {actions.regenerate}
      </button>
    );
  }

  return (
    <div className="confirm">
      <div className="confirm-text">
        {billable ? (
          <>
            <strong>إعادة توليد {label}؟</strong> سيُستهلك رصيد جديد وتُستبدل المخرجات الحالية.
            لا يمكن التراجع.
          </>
        ) : (
          <>
            <strong>إعادة تشغيل {label}؟</strong> ستُستبدل المخرجات الحالية. هذه المرحلة مجانية.
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <form action={runStage}>
          <input type="hidden" name="lessonId" value={lessonId} />
          <input type="hidden" name="stage" value={stage} />
          <input type="hidden" name="force" value="1" />
          <button type="submit" className="btn btn-danger">
            {billable ? "إعادة التوليد واستهلاك الرصيد" : "إعادة التشغيل"}
          </button>
        </form>
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
          إبقاء الحالي
        </button>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} دقيقة ${seconds % 60} ثانية`;
}
