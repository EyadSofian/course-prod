import PgBoss from "pg-boss";
import { z } from "zod";
import { createLogger } from "../logger.js";
import { MAX_ATTEMPTS, STAGES, jobKey, type Stage } from "../stages.js";

/**
 * pg-boss on the same Postgres (§2). No Redis: one less service to pay for and
 * to break.
 */

const log = createLogger("queue");

/** One queue per stage, so a stuck export cannot head-of-line block narration. */
export const QUEUE_NAMES = Object.fromEntries(
  STAGES.map((s) => [s, `stage.${s.toLowerCase()}`]),
) as Record<Stage, string>;

export const stageJobSchema = z.object({
  lessonId: z.string().uuid(),
  stage: z.enum(STAGES),
  attempt: z.number().int().positive(),
  /** Set by a producer clicking regenerate; skips the "already done" guard. */
  force: z.boolean().default(false),
  requestedBy: z.string().uuid().optional(),
});
export type StageJob = z.infer<typeof stageJobSchema>;

let boss: PgBoss | undefined;

export async function getBoss(connectionString?: string): Promise<PgBoss> {
  if (boss) return boss;

  const cs = connectionString ?? process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL is not set");

  boss = new PgBoss({
    // `cs`, not `connectionString`: callers such as queueDepth() and
    // workStage() invoke getBoss() with no argument, which would otherwise
    // hand pg-boss an undefined connection string and fail with a far less
    // obvious error than the explicit check above.
    connectionString: cs,
    // Keep the boss pool small — the app pool is separate and Railway's
    // Postgres connection ceiling is not generous.
    max: 5,
    // Jobs are stage runs; keep history long enough to debug a bad week.
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,
    deleteAfterDays: 30,
  });

  boss.on("error", (e) => log.error("pg-boss error", { error: e }));
  await boss.start();

  for (const name of Object.values(QUEUE_NAMES)) {
    await boss.createQueue(name);
  }

  log.info("queue ready", { queues: Object.values(QUEUE_NAMES) });
  return boss;
}

/**
 * Enqueue one stage attempt. The singleton key is `lesson_id:stage:attempt`
 * (§5), so a double-clicked button and a duplicated webhook collapse into the
 * same job instead of burning two sets of credits.
 */
export async function enqueueStage(job: StageJob): Promise<string | null> {
  const b = await getBoss();
  const payload = stageJobSchema.parse(job);

  const id = await b.send(QUEUE_NAMES[payload.stage], payload, {
    singletonKey: jobKey(payload.lessonId, payload.stage, payload.attempt),
    retryLimit: 0, // Retries are decided by the stage runner, which must first
    retryDelay: 0, // classify the error as retryable or terminal (§9).
    expireInMinutes: 30,
  });

  log.info(id ? "stage enqueued" : "stage already queued", {
    lesson_id: payload.lessonId,
    stage: payload.stage,
    attempt: payload.attempt,
    job_id: id ?? undefined,
  });
  return id;
}

export type StageHandler = (job: StageJob) => Promise<void>;

export async function workStage(stage: Stage, handler: StageHandler): Promise<string> {
  const b = await getBoss();
  return b.work<StageJob>(
    QUEUE_NAMES[stage],
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async ([job]) => {
      if (!job) return;
      const parsed = stageJobSchema.parse(job.data);
      await handler(parsed);
    },
  );
}

export async function queueDepth(): Promise<Record<string, number>> {
  const b = await getBoss();
  const out: Record<string, number> = {};
  for (const [stage, name] of Object.entries(QUEUE_NAMES)) {
    out[stage] = await b.getQueueSize(name);
  }
  return out;
}

/**
 * Graceful shutdown (§9): finish the in-flight job, accept no new ones.
 * Railway redeploys mid-export otherwise corrupt a lesson.
 */
export async function stopBoss(graceSeconds = 60): Promise<void> {
  if (!boss) return;
  log.info("stopping queue, draining in-flight jobs", { graceSeconds });
  await boss.stop({ wait: true, graceful: true, timeout: graceSeconds * 1000 });
  boss = undefined;
  log.info("queue stopped");
}

export { MAX_ATTEMPTS };
