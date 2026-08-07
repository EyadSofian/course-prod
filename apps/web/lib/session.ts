import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
  type SessionPayload,
} from "@course-prod/core/session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is missing or too short");
  return s;
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, secret());
}

/** For server components behind the middleware guard. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function startSession(user: {
  id: string;
  email: string;
  role: "admin" | "producer";
}): Promise<void> {
  const jar = await cookies();
  const token = createSessionToken({ uid: user.id, email: user.email, role: user.role }, secret());
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(process.env.NODE_ENV === "production"));
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
