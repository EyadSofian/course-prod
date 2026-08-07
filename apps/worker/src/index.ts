import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { closeDb, createLogger, getBoss, getWorkerEnv, stopBoss } from "@course-prod/core";
import { workStage } from "@course-prod/core/queue";
import { STAGES } from "@course-prod/core/stages";
import { handleRequest } from "./http.js";
import { registerStage, runStage } from "./runner.js";
import { handleIngest } from "./stages/ingest.js";
import { handleSummarize } from "./stages/summarize.js";
import { handleDeck } from "./stages/deck.js";
import { handleExport } from "./stages/export.js";
import { handleNarrate } from "./stages/narrate.js";
import { handleAssemble } from "./stages/assemble.js";
import { handlePublish } from "./stages/publish.js";

const log = createLogger("worker");
const env = getWorkerEnv();

const state = { shuttingDown: false };

registerStage("INGEST", handleIngest);
registerStage("SUMMARIZE", handleSummarize);
registerStage("DECK", handleDeck);
registerStage("EXPORT", handleExport);
registerStage("NARRATE", handleNarrate);
registerStage("ASSEMBLE", handleAssemble);
registerStage("PUBLISH", handlePublish);

const server = createServer((req, res) => {
  void handleRequest(req, res, state).catch((e) => {
    log.error("unhandled request error", { error: e });
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  });
});

async function start() {
  await mkdir(join(env.STATE_DIR, "objects"), { recursive: true });
  await mkdir(join(env.STATE_DIR, "shots"), { recursive: true });

  await getBoss(env.DATABASE_URL);
  log.info("queue connected");

  for (const stage of STAGES) {
    await workStage(stage, (job) => runStage(job));
  }
  log.info("stage workers registered", { stages: STAGES });

  server.listen(env.PORT, () => {
    log.info("worker listening", { port: env.PORT, state_dir: env.STATE_DIR });
  });
}

/**
 * Graceful shutdown (§9): finish the in-flight job, accept no new ones.
 * Railway redeploys mid-export otherwise corrupt a lesson.
 */
async function shutdown(signal: string) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
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
