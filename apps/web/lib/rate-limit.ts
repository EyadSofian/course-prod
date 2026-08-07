/**
 * Fixed-window limiter for login attempts and upload/export triggers (§10).
 *
 * In-memory and therefore per-instance. That is adequate for ~10 internal users
 * on a single web container; if the web service is ever scaled past one
 * replica this needs to move into Postgres, because a per-instance limiter
 * multiplies the effective limit by the replica count.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
}

/** Opportunistic sweep so the map cannot grow without bound. */
export function sweepRateLimits(): void {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

setInterval(sweepRateLimits, 60_000).unref?.();
