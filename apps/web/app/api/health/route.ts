import { NextResponse } from "next/server";
import { pingDb } from "@course-prod/core/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * §9: /health on both services.
 *
 * The status code is a *deploy gate*, not a monitor, and it answers exactly
 * one question: is this container serving HTTP? If this handler runs at all,
 * the answer is yes, so it always returns 200.
 *
 * Everything else — database reachability, missing configuration — is reported
 * in the body and is for monitoring to alert on. Two rounds of failed deploys
 * taught this the hard way: a non-2xx here makes Railway tear the deployment
 * down, so any condition that could ever be transient (or that we simply
 * mis-predicted, as happened with the config list) takes the whole service
 * offline instead of leaving a degraded one that recovers.
 *
 * Check `status` in the body, not the HTTP code:
 *   "ok"            everything reachable
 *   "degraded"      serving, but the database is unreachable
 *   "misconfigured" serving, but a required variable is missing or too short
 *
 * Public (see middleware PUBLIC_PATHS) so Railway can probe it, and therefore
 * deliberately free of anything that would leak topology or secrets.
 */
export async function GET() {
  const started = Date.now();
  const db = await pingDb();

  const config = {
    sessionSecret: (process.env.SESSION_SECRET?.length ?? 0) >= 32,
    serviceKey: (process.env.SERVICE_KEY?.length ?? 0) >= 32,
    publicUrl: Boolean(process.env.PUBLIC_URL),
    workerUrl: Boolean(process.env.WORKER_URL),
    databaseUrl: Boolean(process.env.DATABASE_URL),
  };

  const configOk = Object.values(config).every(Boolean);
  const status = !configOk ? "misconfigured" : db.ok ? "ok" : "degraded";

  return NextResponse.json(
    {
      service: "web",
      status,
      checks: {
        database: { ok: db.ok, latency_ms: db.latencyMs, ...(db.error ? { error: db.error } : {}) },
        config,
      },
      uptime_s: Math.floor(process.uptime()),
      took_ms: Date.now() - started,
    },
    // Always 200 — reaching this line proves the container serves HTTP, which
    // is the only thing the deploy gate should be asking. See the note above.
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
