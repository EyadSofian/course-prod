"use server";

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, users } from "@course-prod/core/db";
import { createLogger } from "@course-prod/core/logger";
import { hashPassword, verifyPassword } from "@course-prod/core/password";
import { rateLimit } from "@/lib/rate-limit";
import { startSession } from "@/lib/session";
import { auth } from "@/lib/strings";

const log = createLogger("web.auth");

/**
 * Computed once per process and reused, so an unknown address costs the same
 * wall-clock time as a known one without paying for a fresh hash each attempt.
 */
let decoy: Promise<string> | undefined;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword("decoy-password-not-a-credential");
  return decoy;
}

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) return { error: auth.missingFields };

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Limit by IP *and* by account, so one attacker cannot lock out a colleague
  // by hammering their address from a rotating source.
  const byIp = rateLimit(`login:ip:${ip}`, 10, 300);
  const byEmail = rateLimit(`login:email:${email}`, 5, 300);
  if (!byIp.allowed || !byEmail.allowed) {
    log.warn("login rate limited", { ip, email });
    return { error: auth.rateLimited };
  }

  const db = getDb();
  // Matched on lower(email) so this hits the users_email_unique expression
  // index and still finds an account whose row was inserted with mixed case.
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  // Always run a real verify, even with no matching user, so response time does
  // not reveal whether the address exists. The decoy must be a genuine argon2
  // hash: a malformed one would fail fast and reintroduce the timing signal.
  const ok = await verifyPassword(user?.passwordHash ?? (await decoyHash()), password);

  if (!user || !ok) {
    log.warn("login failed", { ip, email });
    return { error: auth.invalid };
  }

  await startSession({ id: user.id, email: user.email, role: user.role });
  log.info("login succeeded", { user_id: user.id, email: user.email });

  redirect(next.startsWith("/") ? next : "/");
}
