"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createLogger, getDb, users, verifyPassword } from "@course-prod/core";
import { rateLimit } from "@/lib/rate-limit";
import { startSession } from "@/lib/session";
import { auth } from "@/lib/strings";

const log = createLogger("web.auth");

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
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Always run a verify, even with no user, so response time does not reveal
  // whether the address exists.
  const dummy = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$3+2wBhdVoAWQ0P0mV0kL0Q";
  const ok = await verifyPassword(user?.passwordHash ?? dummy, password);

  if (!user || !ok) {
    log.warn("login failed", { ip, email });
    return { error: auth.invalid };
  }

  await startSession({ id: user.id, email: user.email, role: user.role });
  log.info("login succeeded", { user_id: user.id, email: user.email });

  redirect(next.startsWith("/") ? next : "/");
}
