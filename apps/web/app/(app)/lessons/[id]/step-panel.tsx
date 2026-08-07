"use client";

import { useState } from "react";
import { formatUsd } from "@course-prod/core/settings";
import type { StageRunStatus } from "@course-prod/core/stages";
import type { Step } from "@/lib/pipeline";

export interface RunSummary {
  status: StageRunStatus;
  attempt: number;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  errorCode: string | null;
  log: Record<string, unknown> | null;
}

/**
 * One step of the production path, expanded.
 *
 * The old timeline gave every stage an identical row and left the producer to
 * work out which one they were meant to touch. Here exactly one step is open —
 * the one that needs them — and it carries its own controls. The rest collapse
 * to a line, because a finished stage and a stage three steps away need no
 * attention and should not compete for it.
 */
export function StepPanel({
  step,
  state,
  run,
  costCents,
  lessonId,
  isCurrent,
  canRun,
  recover,
  runStage,
  children,
}: {
  step: Step;
  state: "done" | "current" | "todo" | "stopped";
  run: RunSummary | null;
  costCents: number;
  lessonId: string;
  isCurrent: boolean;
  /** The producer may start this step now. */
  canRun: boolean;
  /** Lesson is stopped — the run has to bypass the entry-status guard. */
  recover: boolean;
  runStage: (formData: FormData) => Promise<void>;
  /** Step-specific controls, rendered only while this step is the open one. */
  children?: React.ReactNode;
}) {
  const [showLog, setShowLog] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const busy = run?.status === "running";
  const succeeded = run?.status === "succeeded";
  const durationMs =
    run?.finishedAt && run.startedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null;

  const open = isCurrent || state === "stopped";

  return (
    <div className="step" data-state={state} data-open={open}>
      <div className="step-head">
        <span className="step-icon" aria-hidden>
          {state === "done" ? "✓" : step.icon}
        </span>

        <div className="step-title">
          <span className="step-name">{step.label}</span>
          <span className="step-meta">
            {busy
              ? "جارٍ التنفيذ…"
              : state === "stopped"
                ? "متعثّر"
                : succeeded
                  ? "تم"
                  : state === "current"
                    ? step.hint
                    : state === "done"
                      ? "تم"
                      : "لم يبدأ"}
            {run && run.attempt > 1 ? ` · المحاولة ${run.attempt}` : ""}
            {durationMs !== null && succeeded ? ` · ${formatDuration(durationMs)}` : ""}
          </span>
        </div>

        <div className="step-right">
          {costCents > 0 ? <span className="chip num">{formatUsd(costCents)}</span> : null}
          {step.billable && !succeeded ? (
            <span className="chip" style={{ color: "var(--warn)" }}>
              تستهلك رصيداً
            </span>
          ) : null}
          {run?.log ? (
            <button type="button" className="btn btn-ghost" onClick={() => setShowLog((v) => !v)}>
              السجل
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="step-body">
          {children}

          <div className="step-actions">
            {step.kind === "stage" && !busy && canRun && !succeeded ? (
              <form action={runStage}>
                <input type="hidden" name="lessonId" value={lessonId} />
                <input type="hidden" name="stage" value={step.id} />
                {recover ? <input type="hidden" name="force" value="1" /> : null}
                <button type="submit" className="btn btn-primary">
                  {state === "stopped" ? "إعادة المحاولة" : `تشغيل: ${step.label}`}
                </button>
              </form>
            ) : null}

            {/* Regenerate is a separate word from retry on purpose: one is free
                and fixes a failure, the other spends money on a stage that
                already worked. They never appear together. */}
            {step.kind === "stage" && !busy && succeeded ? (
              confirming ? (
                <div className="confirm">
                  <div className="confirm-text">
                    {step.billable ? (
                      <>
                        <strong>إعادة توليد {step.label}؟</strong> سيُستهلك رصيد جديد وتُستبدل
                        المخرجات الحالية. لا يمكن التراجع.
                      </>
                    ) : (
                      <>
                        <strong>إعادة تشغيل {step.label}؟</strong> ستُستبدل المخرجات الحالية.
                        هذه المرحلة مجانية.
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <form action={runStage}>
                      <input type="hidden" name="lessonId" value={lessonId} />
                      <input type="hidden" name="stage" value={step.id} />
                      <input type="hidden" name="force" value="1" />
                      <button type="submit" className="btn btn-danger">
                        {step.billable ? "إعادة التوليد واستهلاك الرصيد" : "إعادة التشغيل"}
                      </button>
                    </form>
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                      إبقاء الحالي
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
                  إعادة التوليد
                </button>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {showLog && run?.log ? <pre className="stage-log">{JSON.stringify(run.log, null, 2)}</pre> : null}
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} ثانية`;
  return `${Math.floor(seconds / 60)} دقيقة ${seconds % 60} ثانية`;
}
