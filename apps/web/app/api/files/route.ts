import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "node:stream";
import { createLogger } from "@course-prod/core/logger";
import { createObjectStore, verifySignedKey } from "@course-prod/core/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("web.files");

/**
 * Signed-URL file serving (§6.8). No public bucket: the volume is never exposed
 * directly, and every URL carries an HMAC and a 24h expiry.
 */

const CONTENT_TYPES: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  png: "image/png",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  srt: "application/x-subrip",
  zip: "application/zip",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
};

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const expires = Number(req.nextUrl.searchParams.get("expires"));
  const sig = req.nextUrl.searchParams.get("sig");

  if (!key || !sig || !Number.isFinite(expires)) {
    return NextResponse.json({ error: "رابط غير صالح." }, { status: 400 });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    log.error("SESSION_SECRET missing, cannot verify signed url");
    return NextResponse.json({ error: "إعداد ناقص على الخادم." }, { status: 500 });
  }

  if (!verifySignedKey({ key, expires, sig }, secret)) {
    // Expired and forged are the same response — a distinct "expired" message
    // would let anyone probe which keys exist.
    return NextResponse.json({ error: "انتهت صلاحية الرابط أو أنه غير صالح." }, { status: 403 });
  }

  const store = createObjectStore({
    stateDir: process.env.STATE_DIR ?? "/data",
    secret,
    publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3000",
  });

  const head = await store.headObject(key);
  if (!head.exists) {
    return NextResponse.json({ error: "الملف غير موجود." }, { status: 404 });
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const stream = await store.getStream(key);

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "content-length": String(head.bytes),
      "content-disposition": `attachment; filename="${encodeURIComponent(key.split("/").pop() ?? "file")}"`,
      "cache-control": "private, max-age=3600",
    },
  });
}
