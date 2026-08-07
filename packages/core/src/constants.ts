/**
 * Zero-import module. Anything the edge runtime needs to know lives here.
 *
 * middleware.ts runs on the edge, where argon2's .node binary cannot load and
 * most of node:crypto is unavailable — so the cookie *name* has to be reachable
 * without pulling in a single line of either.
 */

export const SESSION_COOKIE = "cp_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
