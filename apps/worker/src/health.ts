import { statfs } from "node:fs/promises";
import { pingDb } from "@course-prod/core/db";
import { describeError } from "@course-prod/core/logger";
import { queueDepth } from "@course-prod/core/queue";

/**
 * §9: /health reports DB, queue depth, Dokie session validity and disk free.
 *
 * Disk free matters more here than it looks: one lesson's PNGs + MP3s + MP4 run
 * to hundreds of megabytes, and a full volume fails ffmpeg with an error that
 * reads nothing like "out of space".
 */

export interface HealthReport {
  service: "worker";
  status: "ok" | "degraded";
  checks: {
    database: { ok: boolean; latency_ms: number; error?: string };
    queue: { ok: boolean; depth?: Record<string, number>; error?: string };
    disk: { ok: boolean; free_mb?: number; total_mb?: number; percent_used?: number; error?: string };
    dokie_session: { ok: boolean; state: "valid" | "missing" | "unknown" };
  };
  uptime_s: number;
  took_ms: number;
}

const DISK_WARN_PERCENT = 90;

export async function buildHealthReport(stateDir: string): Promise<HealthReport> {
  const started = Date.now();

  const [db, queue, disk] = await Promise.all([
    pingDb(),
    queueDepth()
      .then((depth) => ({ ok: true, depth }))
      .catch((e: unknown) => ({ ok: false, error: describeError(e) })),
    checkDisk(stateDir),
  ]);

  // M1: no Dokie session exists yet — the exporter lands in M4. Reported as
  // "missing" rather than failing, so a green /health in M1 is honest.
  const dokie = { ok: true, state: "missing" as const };

  const status = db.ok && queue.ok && disk.ok ? "ok" : "degraded";

  return {
    service: "worker",
    status,
    checks: {
      database: { ok: db.ok, latency_ms: db.latencyMs, ...(db.error ? { error: db.error } : {}) },
      queue,
      disk,
      dokie_session: dokie,
    },
    uptime_s: Math.floor(process.uptime()),
    took_ms: Date.now() - started,
  };
}

async function checkDisk(path: string) {
  try {
    const s = await statfs(path);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    const percentUsed = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
    return {
      ok: percentUsed < DISK_WARN_PERCENT,
      free_mb: Math.round(freeBytes / 1024 / 1024),
      total_mb: Math.round(totalBytes / 1024 / 1024),
      percent_used: percentUsed,
    };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}
