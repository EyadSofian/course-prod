import { hash, verify } from "@node-rs/argon2";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Email + password with argon2id, sessions in signed httpOnly cookies (§10).
 * No public signup — accounts are created by an admin or the bootstrap script.
 */

// OWASP-recommended argon2id floor; comfortably fast on Railway's shared CPU.
const ARGON_OPTS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) throw new Error("Password must be at least 12 characters");
  return hash(plain, ARGON_OPTS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    // A malformed hash must read as "wrong password", never as a crash that
    // distinguishes this account from any other.
    return false;
  }
}

/* ── sessions ──────────────────────────────────────────────────────────── */

export const SESSION_COOKIE = "cp_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

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
 * Constant-time-ish comparison for the worker's SERVICE_KEY header (§10).
 * The worker's HTTP surface is not publicly routed, but a shared secret still
 * needs comparing without leaking length via early return.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
