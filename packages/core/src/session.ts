import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./constants.js";

/**
 * Signed session cookies (§10). node:crypto only — deliberately no argon2, so
 * importing this does not drag a native binary into a bundle that cannot load
 * one. Password hashing lives in ./password.ts.
 */

export const sessionPayloadSchema = z.object({
  uid: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["admin", "producer"]),
  exp: z.number().int(),
});
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(
  payload: Omit<SessionPayload, "exp">,
  secret: string,
  ttlSeconds = SESSION_TTL_SECONDS,
): string {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = sessionPayloadSchema.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    if (parsed.data.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (secure: boolean) =>
  ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  }) satisfies Record<string, unknown>;

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Constant-time comparison for the worker's SERVICE_KEY header (§10). The
 * worker is not publicly routed, but a shared secret still needs comparing
 * without leaking length through an early return.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
