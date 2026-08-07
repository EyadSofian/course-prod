import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { getWorkerEnv, safeEqual } from "@course-prod/core";
import { getDb, lessons } from "@course-prod/core/db";
import { createLogger } from "@course-prod/core/logger";
import { enqueueStage } from "@course-prod/core/queue";
import { STAGES, type Stage } from "@course-prod/core/stages";
import { lessonKey } from "@course-prod/core/storage";
import { objectStore } from "./context.js";
import { isAccepted, MAX_UPLOAD_BYTES } from "./extract.js";
import { answerDeckQuestion } from "./stages/deck.js";
import { runSelfTest } from "./self-test.js";
import { buildHealthReport } from "./health.js";

const log = createLogger("worker.http");

/**
 * The worker's HTTP surface (§10): SERVICE_KEY on everything except /health,
 * and never publicly routed.
 *
 * It exists because the Railway volume mounts to exactly one service. The web
 * container cannot read or write /data, so uploads come in through here and
 * downloads are streamed back out through here.
 */

export function authorized(req: IncomingMessage): boolean {
  const header = req.headers["x-service-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  return Boolean(provided && safeEqual(provided, getWorkerEnv().SERVICE_KEY));
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).byteLength;
    if (total > limit) {
      throw Object.assign(new Error("payload too large"), { statusCode: 413 });
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: { shuttingDown: boolean },
): Promise<void> {
  const env = getWorkerEnv();
  const url = new URL(req.url ?? "/", `http://localhost:${env.PORT}`);

  if (url.pathname === "/health") {
    if (state.shuttingDown) return json(res, 503, { service: "worker", status: "draining" });
    const report = await buildHealthReport(env.STATE_DIR);
    return json(res, report.status === "ok" ? 200 : 503, report);
  }

  if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

  try {
    if (url.pathname === "/upload" && req.method === "POST") return await upload(req, res, url);
    if (url.pathname === "/object" && req.method === "GET") return await getObject(res, url);
    if (url.pathname === "/enqueue" && req.method === "POST") return await enqueue(req, res);
    if (url.pathname === "/dokie/reply" && req.method === "POST") return await dokieReply(req, res);
    if (url.pathname === "/self-test") return json(res, 200, await runSelfTest());
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 500;
    log.error("request failed", { path: url.pathname, error: e });
    return json(res, status, { error: (e as Error).message });
  }

  return json(res, 404, { error: "not found" });
}

/**
 * Raw-body upload with the filename in a header, rather than multipart.
 * The only client is our own web service, so there is no reason to carry a
 * multipart parser and its parsing surface for a single-file POST.
 */
async function upload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const lessonId = url.searchParams.get("lessonId");
  const filename = String(req.headers["x-filename"] ?? "");
  if (!lessonId || !filename) {
    return json(res, 400, { error: "lessonId and X-Filename are required" });
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!isAccepted(ext)) {
    return json(res, 415, {
      error: `صيغة .${ext} غير مدعومة. المدعوم: PDF، DOCX، PPTX، MD، TXT.`,
    });
  }

  const body = await readBody(req, MAX_UPLOAD_BYTES);
  const key = lessonKey.sourceFile(lessonId, ext);
  await objectStore().putObject(key, body);

  await getDb()
    .update(lessons)
    .set({ sourceFileKey: key, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId));

  log.info("source uploaded", { lesson_id: lessonId, bytes: body.byteLength, ext });
  return json(res, 200, { key, bytes: body.byteLength });
}

/** Streams a stored object back to the web service, which serves it onward. */
async function getObject(res: ServerResponse, url: URL): Promise<void> {
  const key = url.searchParams.get("key");
  if (!key) return json(res, 400, { error: "key is required" });

  const store = objectStore();
  const head = await store.headObject(key);
  if (!head.exists) return json(res, 404, { error: "not found" });

  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": String(head.bytes),
  });

  // pipeline handles backpressure and destroys both ends on error, so a
  // client that hangs up mid-download cannot leak an open file handle.
  await pipeline(await store.getStream(key), res);
}

async function enqueue(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8")) as {
    lessonId?: string;
    stage?: string;
    force?: boolean;
    requestedBy?: string;
  };

  if (!body.lessonId || !body.stage || !(STAGES as readonly string[]).includes(body.stage)) {
    return json(res, 400, { error: "lessonId and a valid stage are required" });
  }

  const id = await enqueueStage({
    lessonId: body.lessonId,
    stage: body.stage as Stage,
    attempt: 1,
    force: body.force ?? false,
    requestedBy: body.requestedBy,
  });

  return json(res, 202, { jobId: id ?? null, correlationId: randomUUID() });
}

async function dokieReply(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8")) as {
    lessonId?: string;
    answer?: string;
  };
  if (!body.lessonId || !body.answer) {
    return json(res, 400, { error: "lessonId and answer are required" });
  }

  await answerDeckQuestion(body.lessonId, body.answer);
  // Answering resumes generation, so the stage is re-queued to pick it up.
  await enqueueStage({
    lessonId: body.lessonId,
    stage: "DECK",
    attempt: 1,
    force: true,
  });
  return json(res, 202, { ok: true });
}
