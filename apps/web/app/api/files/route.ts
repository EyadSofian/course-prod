import { NextResponse, type NextRequest } from "next/server";
import { createLogger } from "@course-prod/core/logger";
import { verifySignedKey } from "@course-prod/core/storage";
import { fetchObject } from "@/lib/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("web.files");

/**
 * Signed-URL file serving (§6.8). No public bucket: every URL carries an HMAC
 * and a 24h expiry, verified here before anything is read.
 *
 * The bytes themselves live on the worker's volume — Railway mounts a volume
 * to exactly one service — so this route verifies the signature and then
 * streams the object through the worker's private surface.
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
    // Expired and forged get the same response — distinguishing them would let
    // anyone probe which keys exist.
    return NextResponse.json({ error: "انتهت صلاحية الرابط أو أنه غير صالح." }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetchObject(key);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404) return NextResponse.json({ error: "الملف غير موجود." }, { status: 404 });
    log.error("failed to fetch object from worker", { key, error: e });
    return NextResponse.json({ error: "تعذّر الوصول إلى الملف." }, { status: 502 });
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const filename = key.split("/").pop() ?? "file";

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      ...(upstream.headers.get("content-length")
        ? { "content-length": upstream.headers.get("content-length")! }
        : {}),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, max-age=3600",
    },
  });
}
