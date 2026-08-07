import { NextResponse } from "next/server";
import { pingDb } from "@course-prod/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * §9: /health on both services. The web service owns DB reachability and its
 * own config validity; queue depth and disk free are the worker's /health,
 * because only the worker mounts the volume.
 *
 * Public (see middleware PUBLIC_PATHS) so Railway can probe it, and therefore
 * deliberately free of anything that would leak topology or secrets.
 */
export async function GET() {
  const started = Date.now();
  const db = await pingDb();

  const configured = {
    sessionSecret: (process.env.SESSION_SECRET?.length ?? 0) >= 32,
    serviceKey: (process.env.SERVICE_KEY?.length ?? 0) >= 32,
    publicUrl: Boolean(process.env.PUBLIC_URL),
  };

  const ok = db.ok && Object.values(configured).every(Boolean);

  return NextResponse.json(
    {
      service: "web",
      status: ok ? "ok" : "degraded",
      checks: {
        database: { ok: db.ok, latency_ms: db.latencyMs, ...(db.error ? { error: db.error } : {}) },
        config: configured,
      },
      uptime_s: Math.floor(process.uptime()),
      took_ms: Date.now() - started,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
