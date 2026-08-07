import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

/**
 * argon2id password hashing (§10), via WASM rather than a native binding.
 *
 * The native @node-rs/argon2 ships a per-platform .node binary, which caused
 * two concrete problems: Next's standalone output tracing could not follow it
 * through the symlinked workspace package (the build passed and the server
 * then crashed at boot with MODULE_NOT_FOUND), and building on arm64 macOS
 * while deploying to linux on Railway needs the matching optional dependency
 * present at install time.
 *
 * WASM has neither problem — same algorithm, one artefact, every platform.
 * It is roughly 2–3x slower per hash, which is irrelevant at ~10 users
 * logging in.
 */

// OWASP-recommended argon2id floor.
const MEMORY_KIB = 19_456; // 19 MiB
const ITERATIONS = 2;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) throw new Error("Password must be at least 12 characters");

  return argon2id({
    password: plain,
    salt: randomBytes(SALT_LENGTH),
    parallelism: PARALLELISM,
    iterations: ITERATIONS,
    memorySize: MEMORY_KIB,
    hashLength: HASH_LENGTH,
    outputType: "encoded",
  });
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: plain, hash: hashed });
  } catch {
    // A malformed hash must read as "wrong password", never as a crash that
    // distinguishes this account from any other.
    return false;
  }
}
