import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

let pool: pg.Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function getPool(databaseUrl?: string): pg.Pool {
  if (!pool) {
    const connectionString = databaseUrl ?? process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      // Railway terminates idle connections; fail fast rather than hanging a
      // request behind a dead socket.
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function getDb(databaseUrl?: string): NodePgDatabase<typeof schema> {
  db ??= drizzle(getPool(databaseUrl), { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

/** Cheap liveness probe for /health (§9). */
export async function pingDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await getPool().query("select 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: (e as Error).message };
  }
}

export { schema };
