import { NextResponse } from "next/server";
import { pingDb } from "@course-prod/core/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * §9: /health on both services.
 *
 * The status code is a *deploy gate*, not a monitor. Railway rolls a
 * deployment back when this returns non-2xx, so the two kinds of problem get
 * different treatment:
 *
 *   - Bad configuration is permanent. A deploy with a missing SESSION_SECRET
 *     will never become healthy, so it returns 503 and should be rolled back.
 *
 *   - An unreachable database is usually transient. Returning 503 for it meant
 *     a database blip during a deploy tore down a perfectly good container and
 *     left no service at all, instead of a degraded one that recovers when the
 *     database comes back. It is reported in the body as "degraded" and
 *     alerted on from there.
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
    // 503 only for misconfiguration — see the note above.
    { status: configOk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
