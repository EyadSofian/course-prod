import { eq } from "drizzle-orm";
import {
  MAX_ATTEMPTS,
  STAGE_SPEC,
  TerminalError,
  backoffMs,
  canRunStage,
  describeError,
  isRetryable,
  loadSettings,
  nextStage,
  sendAlert,
  type Settings,
  type Stage,
} from "@course-prod/core";
import { getDb, lessons, stageRuns, courses, type Lesson } from "@course-prod/core/db";
import { createLogger, type Logger } from "@course-prod/core/logger";
import { enqueueStage, type StageJob } from "@course-prod/core/queue";
import { getWorkerEnv } from "@course-prod/core";

/**
 * The stage runner — this is what replaces n8n (§9).
 *
 * Responsibilities, none optional:
 *   - one stage_runs row per attempt, always closed out
 *   - retryable vs terminal classification, never retrying a terminal error
 *   - exponential backoff, max 3 attempts
 *   - lesson status transitions, including BLOCKED_BUDGET
 *   - Telegram alerts on terminal failure and budget blocks
 *   - structured logs carrying lesson_id + stage on every line
 */

export interface StageContext {
  lesson: Lesson;
  settings: Settings;
  log: Logger;
  attempt: number;
  force: boolean;
  /** Merged into stage_runs.log on completion. */
  record(fields: Record<string, unknown>): void;
  /** Added to this run's cost and to the lesson total. */
  charge(cents: number): void;
}

export interface StageOutcome {
  /** Overrides the default status from STAGE_SPEC — used by DECK's needs-reply pause. */
  status?: Lesson["status"];
  /** Skip auto-advancing to the next stage even on success. */
  halt?: boolean;
}

export type StageHandler = (ctx: StageContext) => Promise<StageOutcome | void>;

const handlers = new Map<Stage, StageHandler>();

export function registerStage(stage: Stage, handler: StageHandler): void {
  handlers.set(stage, handler);
}

/**
 * Stages that continue automatically once done. Everything up to the human
 * gate stops at SUMMARIZED (§5); after approval the chain runs to PUBLISHED
 * unless a stage halts it.
 */
const AUTO_ADVANCE: Stage[] = ["INGEST", "DECK", "EXPORT", "NARRATE", "ASSEMBLE"];

export async function runStage(job: StageJob): Promise<void> {
  const db = getDb();
  const log = createLogger("worker").child({
    lesson_id: job.lessonId,
    stage: job.stage,
    attempt: job.attempt,
  });

  const handler = handlers.get(job.stage);
  if (!handler) {
    log.error("no handler registered for stage");
    return;
  }

  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, job.lessonId)).limit(1);
  if (!lesson) {
    log.warn("lesson vanished before stage ran, dropping job");
    return;
  }

  // Guard re-entry: a stage may only run from its declared `from` status.
  // Without this a duplicated job could re-run DECK on an already-exported
  // lesson and spend credits twice.
  if (!job.force && !canRunStage(job.stage, lesson.status)) {
    log.warn("stage not runnable from current status, skipping", { status: lesson.status });
    return;
  }

  const settings = await loadSettings();
  const logFields: Record<string, unknown> = {};
  let costCents = 0;

  const [run] = await db
    .insert(stageRuns)
    .values({ lessonId: lesson.id, stage: job.stage, attempt: job.attempt, status: "running" })
    .onConflictDoNothing()
    .returning({ id: stageRuns.id });

  if (!run) {
    // The unique (lesson, stage, attempt) index already holds this attempt —
    // a duplicate delivery. Dropping it is the whole point of the index.
    log.warn("attempt already recorded, treating as duplicate delivery");
    return;
  }

  await db
    .update(lessons)
    .set({ currentStage: job.stage, error: null, errorCode: null, updatedAt: new Date() })
    .where(eq(lessons.id, lesson.id));

  const startedAt = Date.now();
  log.info("stage started");

  try {
    const outcome = (await handler({
      lesson,
      settings,
      log,
      attempt: job.attempt,
      force: job.force,
      record: (fields) => Object.assign(logFields, fields),
      charge: (cents) => {
        costCents += cents;
      },
    })) ?? {};

    const status = outcome.status ?? STAGE_SPEC[job.stage].to;

    await db
      .update(stageRuns)
      .set({ status: "succeeded", finishedAt: new Date(), log: logFields, costCents })
      .where(eq(stageRuns.id, run.id));

    await db
      .update(lessons)
      .set({
        status,
        currentStage: null,
        error: null,
        errorCode: null,
        costCents: lesson.costCents + costCents,
        updatedAt: new Date(),
      })
      .where(eq(lessons.id, lesson.id));

    log.info("stage succeeded", {
      duration_ms: Date.now() - startedAt,
      cost_cents: costCents,
      status,
    });

    if (!outcome.halt && AUTO_ADVANCE.includes(job.stage)) {
      const next = nextStage(status);
      if (next) {
        await enqueueStage({
          lessonId: lesson.id,
          stage: next,
          attempt: 1,
          force: false,
          requestedBy: job.requestedBy,
        });
      }
    }
  } catch (error) {
    await handleFailure({ job, runId: run.id, lesson, error, logFields, costCents, log, settings });
  }
}

async function handleFailure(args: {
  job: StageJob;
  runId: string;
  lesson: Lesson;
  error: unknown;
  logFields: Record<string, unknown>;
  costCents: number;
  log: Logger;
  settings: Settings;
}): Promise<void> {
  const { job, runId, lesson, error, logFields, costCents, log } = args;
  const db = getDb();

  const terminal = error instanceof TerminalError;
  const code = terminal ? error.code : undefined;
  const message = describeError(error);
  const budgetBlocked = code === "BUDGET_BLOCKED";
  const retryable = !terminal && isRetryable(error) && job.attempt < MAX_ATTEMPTS;

  if (terminal && error.detail !== undefined) logFields.detail = error.detail;
  logFields.error = message;

  await db
    .update(stageRuns)
    .set({
      status: budgetBlocked ? "blocked" : "failed",
      finishedAt: new Date(),
      log: logFields,
      errorCode: code ?? (retryable ? "RETRYABLE" : "EXHAUSTED"),
      costCents,
    })
    .where(eq(stageRuns.id, runId));

  if (retryable) {
    const delay = backoffMs(job.attempt);
    log.warn("stage failed, retrying", {
      error: message,
      next_attempt: job.attempt + 1,
      delay_ms: delay,
    });

    // Money already spent on this attempt stays on the lesson — a retry that
    // re-bills must not silently reset the total.
    if (costCents) {
      await db
        .update(lessons)
        .set({ costCents: lesson.costCents + costCents, updatedAt: new Date() })
        .where(eq(lessons.id, lesson.id));
    }

    setTimeout(() => {
      void enqueueStage({ ...job, attempt: job.attempt + 1 }).catch((e) =>
        log.error("failed to enqueue retry", { error: e }),
      );
    }, delay).unref?.();
    return;
  }

  await db
    .update(lessons)
    .set({
      status: budgetBlocked ? "BLOCKED_BUDGET" : "FAILED",
      currentStage: null,
      error: message,
      errorCode: code ?? "EXHAUSTED",
      costCents: lesson.costCents + costCents,
      updatedAt: new Date(),
    })
    .where(eq(lessons.id, lesson.id));

  log.error("stage failed terminally", { error: message, code });

  // §9: alert on terminal failure and budget block. Alerting must never throw
  // back into the runner, so sendAlert swallows its own errors.
  const [course] = await db
    .select({ code: courses.code })
    .from(courses)
    .where(eq(courses.id, lesson.courseId))
    .limit(1);

  await sendAlert({
    kind: budgetBlocked ? "budget_blocked" : "stage_failed",
    lessonCode: course?.code ?? lesson.id.slice(0, 8),
    lessonId: lesson.id,
    stage: job.stage,
    message,
    url: `${getWorkerEnv().PUBLIC_URL}/lessons/${lesson.id}`,
  });
}
