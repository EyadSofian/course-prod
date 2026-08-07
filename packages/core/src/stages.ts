/**
 * The pipeline state machine (§5).
 *
 * Two separate vocabularies, deliberately not merged:
 *   - LessonStatus: where a lesson *is*.
 *   - Stage: a unit of work that *runs*.
 *
 * A stage's job is to move the lesson from `from` to `to`. Re-running a stage
 * never re-runs its predecessor (§5), which is why `nextStage` is derived from
 * the lesson's current status rather than from a cursor we increment.
 */

export const LESSON_STATUSES = [
  "DRAFT",
  "INGESTED",
  "SUMMARIZED",
  "REVIEWED",
  "DECK_READY",
  "DECK_EXPORTED",
  "NARRATED",
  "ASSEMBLED",
  "PUBLISHED",
  "FAILED",
  "BLOCKED_BUDGET",
] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const STAGES = [
  "INGEST",
  "SUMMARIZE",
  "DECK",
  "EXPORT",
  "NARRATE",
  "ASSEMBLE",
  "PUBLISH",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_RUN_STATUSES = ["running", "succeeded", "failed", "blocked"] as const;
export type StageRunStatus = (typeof STAGE_RUN_STATUSES)[number];

interface StageSpec {
  /** Status the lesson must be in for this stage to be runnable. */
  from: LessonStatus;
  /** Status written on success. */
  to: LessonStatus;
  /** Whether running this stage spends money with a third party. */
  billable: boolean;
}

export const STAGE_SPEC: Record<Stage, StageSpec> = {
  INGEST: { from: "DRAFT", to: "INGESTED", billable: false },
  SUMMARIZE: { from: "INGESTED", to: "SUMMARIZED", billable: true },
  // SUMMARIZED -> REVIEWED is the human gate (§5). No stage owns it.
  DECK: { from: "REVIEWED", to: "DECK_READY", billable: true },
  EXPORT: { from: "DECK_READY", to: "DECK_EXPORTED", billable: false },
  NARRATE: { from: "DECK_EXPORTED", to: "NARRATED", billable: true },
  ASSEMBLE: { from: "NARRATED", to: "ASSEMBLED", billable: false },
  PUBLISH: { from: "ASSEMBLED", to: "PUBLISHED", billable: false },
};

/** Stages that spend third-party money and therefore need a budget check first (§7). */
export const BILLABLE_STAGES: Stage[] = STAGES.filter((s) => STAGE_SPEC[s].billable);

/**
 * REVIEWED is a human gate. Nothing auto-advances past SUMMARIZED (§5) — the
 * absence of SUMMARIZED from this map is what enforces it.
 */
const NEXT_STAGE: Partial<Record<LessonStatus, Stage>> = {
  DRAFT: "INGEST",
  INGESTED: "SUMMARIZE",
  REVIEWED: "DECK",
  DECK_READY: "EXPORT",
  DECK_EXPORTED: "NARRATE",
  NARRATED: "ASSEMBLE",
  ASSEMBLED: "PUBLISH",
};

export function nextStage(status: LessonStatus): Stage | null {
  return NEXT_STAGE[status] ?? null;
}

/** A stage may run only from its declared `from` status. Guards accidental re-entry. */
export function canRunStage(stage: Stage, status: LessonStatus): boolean {
  return STAGE_SPEC[stage].from === status;
}

/**
 * Idempotency key (§5): `lesson_id:stage:attempt`. pg-boss uses this as the
 * singleton key so a double-click cannot enqueue the same attempt twice.
 */
export function jobKey(lessonId: string, stage: Stage, attempt: number): string {
  return `${lessonId}:${stage}:${attempt}`;
}

export const MAX_ATTEMPTS = 3;

/**
 * Retryable vs terminal (§9). Never retry a terminal error — a validation
 * failure will fail identically three times and a budget block is a policy
 * decision, not a fault.
 */
export class TerminalError extends Error {
  override readonly name = "TerminalError";
  constructor(
    message: string,
    readonly code: TerminalCode,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export class RetryableError extends Error {
  override readonly name = "RetryableError";
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export const TERMINAL_CODES = [
  "SCHEMA_VALIDATION",
  "INVARIANT_VIOLATION",
  "AUTH_FAILURE",
  "BUDGET_BLOCKED",
  "SELECTOR_NOT_FOUND",
  "ASSET_COUNT_MISMATCH",
  "UNSUPPORTED_INPUT",
  "LIMIT_EXCEEDED",
] as const;
export type TerminalCode = (typeof TERMINAL_CODES)[number];

/**
 * Classifies an unknown thrown value. Anything we do not recognise is treated
 * as retryable — a transient fault retried three times is cheap, whereas a
 * transient fault misfiled as terminal wakes someone up.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TerminalError) return false;
  if (err instanceof RetryableError) return true;

  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500) return true;
    if (status === 401 || status === 403) return false;
    if (status >= 400) return false;
  }
  return true;
}

/** Exponential backoff with full jitter, so three workers do not retry in lockstep. */
export function backoffMs(attempt: number, baseMs = 2_000, capMs = 60_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * exponential);
}
