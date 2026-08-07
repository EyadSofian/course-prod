import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

/**
 * Storage sits behind this interface so moving to S3/R2 is a config swap, not a
 * rewrite (§2). Keys are POSIX-style paths (`lessons/<id>/slides/s01.png`) and
 * carry no leading slash.
 */
export interface ObjectStore {
  putObject(key: string, body: Buffer | string, contentType?: string): Promise<PutResult>;
  getObject(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  headObject(key: string): Promise<{ bytes: number; exists: boolean }>;
  deleteObject(key: string): Promise<void>;
  /** Time-limited URL. 24h default per §6.8 — no public bucket, ever. */
  signUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface PutResult {
  key: string;
  bytes: number;
}

export const DEFAULT_URL_TTL_SECONDS = 24 * 60 * 60;

/* ── key hygiene ───────────────────────────────────────────────────────── */

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export function assertSafeKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return key;
}

export const lessonKey = {
  sourceFile: (lessonId: string, ext: string) => `lessons/${lessonId}/source/original.${ext}`,
  sourceText: (lessonId: string) => `lessons/${lessonId}/source/extracted.txt`,
  deckPptx: (lessonId: string) => `lessons/${lessonId}/deck/deck.pptx`,
  deckPdf: (lessonId: string) => `lessons/${lessonId}/deck/deck.pdf`,
  slidePng: (lessonId: string, slideId: string) => `lessons/${lessonId}/slides/${slideId}.png`,
  audioMp3: (lessonId: string, slideId: string) => `lessons/${lessonId}/audio/${slideId}.mp3`,
  audioMerged: (lessonId: string) => `lessons/${lessonId}/audio/lesson.mp3`,
  lessonMp4: (lessonId: string) => `lessons/${lessonId}/video/lesson.mp4`,
  srt: (lessonId: string) => `lessons/${lessonId}/video/lesson.srt`,
  quizPdf: (lessonId: string) => `lessons/${lessonId}/quiz/quiz.pdf`,
  packageZip: (lessonId: string) => `lessons/${lessonId}/package.zip`,
};

/* ── signing ───────────────────────────────────────────────────────────── */

export interface SignedUrlParts {
  key: string;
  expires: number;
  sig: string;
}

export function signKey(key: string, secret: string, expiresInSeconds: number): SignedUrlParts {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sig = createHmac("sha256", secret).update(`${key}:${expires}`).digest("base64url");
  return { key, expires, sig };
}

export function verifySignedKey(parts: SignedUrlParts, secret: string): boolean {
  if (!Number.isFinite(parts.expires) || parts.expires < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${parts.key}:${parts.expires}`)
    .digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── local volume driver ───────────────────────────────────────────────── */

/**
 * Backed by the Railway volume mounted at /data (§2). The web service serves
 * these through a signed-URL route rather than exposing the directory.
 */
export class LocalObjectStore implements ObjectStore {
  constructor(
    private readonly root: string,
    private readonly secret: string,
    private readonly publicUrl: string,
  ) {}

  private path(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, normalize(key));
    // Defence in depth: even with a safe-looking key, refuse anything that
    // resolves outside the volume root.
    if (!full.startsWith(resolve(this.root) + sep)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return full;
  }

  async putObject(key: string, body: Buffer | string): Promise<PutResult> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    await writeFile(full, buf);
    return { key, bytes: buf.byteLength };
  }

  async getObject(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.path(key);
    await stat(full);
    return createReadStream(full);
  }

  async headObject(key: string): Promise<{ bytes: number; exists: boolean }> {
    try {
      const s = await stat(this.path(key));
      return { bytes: s.size, exists: true };
    } catch {
      return { bytes: 0, exists: false };
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  async signUrl(key: string, expiresInSeconds = DEFAULT_URL_TTL_SECONDS): Promise<string> {
    const { expires, sig } = signKey(key, this.secret, expiresInSeconds);
    const u = new URL("/api/files", this.publicUrl);
    u.searchParams.set("key", key);
    u.searchParams.set("expires", String(expires));
    u.searchParams.set("sig", sig);
    return u.toString();
  }
}

export function createObjectStore(opts: {
  stateDir: string;
  secret: string;
  publicUrl: string;
}): ObjectStore {
  return new LocalObjectStore(join(opts.stateDir, "objects"), opts.secret, opts.publicUrl);
}
