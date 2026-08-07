import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  closeDb,
  createLogger,
  getBoss,
  getWorkerEnv,
  safeEqual,
  stopBoss,
} from "@course-prod/core";
import { buildHealthReport } from "./health.js";

const log = createLogger("worker");
const env = getWorkerEnv();

/**
 * M1 worker: boots, owns the queue, exposes /health, and shuts down
 * gracefully. Stage handlers register here from M2 onward.
 */

let shuttingDown = false;

/* ── http surface ──────────────────────────────────────────────────────── */

/**
 * §10: the worker's HTTP surface is protected by SERVICE_KEY and is not
 * publicly routed. /health is the one exception — Railway's probe cannot send
 * the header, and the report deliberately contains nothing sensitive.
 */
function authorized(req: IncomingMessage): boolean {
  const header = req.headers["x-service-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  return Boolean(provided && safeEqual(provided, env.SERVICE_KEY));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${env.PORT}`);

  if (url.pathname === "/health") {
    // While draining, report degraded so the load balancer stops routing here
    // before the process actually goes away.
    if (shuttingDown) return json(res, 503, { service: "worker", status: "draining" });
    const report = await buildHealthReport(env.STATE_DIR);
    return json(res, report.status === "ok" ? 200 : 503, report);
  }

  if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

  // /self-test lands in M4 alongside the Dokie exporter (§6.5).
  return json(res, 404, { error: "not found" });
});

/* ── lifecycle ─────────────────────────────────────────────────────────── */

async function start() {
  // The volume must exist before any stage writes to it; on a fresh Railway
  // volume these directories are not there.
  await mkdir(join(env.STATE_DIR, "objects"), { recursive: true });
  await mkdir(join(env.STATE_DIR, "shots"), { recursive: true });

  await getBoss(env.DATABASE_URL);
  log.info("queue connected");

  // M2+: workStage("INGEST", handleIngest) and friends register here.

  server.listen(env.PORT, () => {
    log.info("worker listening", { port: env.PORT, state_dir: env.STATE_DIR });
  });
}

/**
 * Graceful shutdown (§9): finish the in-flight job, accept no new ones.
 * Railway redeploys mid-export otherwise corrupt a lesson.
 */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutdown started", { signal });

  // Railway sends SIGKILL after ~30s; drain inside that window rather than
  // being killed halfway through a database write.
  const hardExit = setTimeout(() => {
    log.error("graceful shutdown timed out, exiting");
    process.exit(1);
  }, 25_000);
  hardExit.unref();

  server.close();
  try {
    await stopBoss(20);
    await closeDb();
    log.info("shutdown complete");
    process.exit(0);
  } catch (e) {
    log.error("shutdown failed", { error: e });
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection", { error: reason });
});

start().catch((e) => {
  log.error("worker failed to start", { error: e });
  process.exit(1);
});
