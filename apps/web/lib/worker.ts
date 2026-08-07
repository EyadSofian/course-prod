import "server-only";
import { describeError } from "@course-prod/core/logger";

/**
 * Client for the worker's private HTTP surface (§10).
 *
 * The Railway volume mounts to the worker alone, so the web service cannot
 * touch /data directly. Uploads are posted here and downloads are streamed
 * back through here; the SERVICE_KEY header is what makes that safe on a
 * private network.
 */

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function config(): { baseUrl: string; serviceKey: string } {
  const raw = process.env.WORKER_URL;
  const serviceKey = process.env.SERVICE_KEY;

  if (!raw) {
    throw new WorkerError(
      "WORKER_URL غير مضبوط على خدمة web. اضبطه على " +
        "http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:3001",
      0,
    );
  }
  if (!serviceKey) throw new WorkerError("SERVICE_KEY غير مضبوط على خدمة web.", 0);

  const baseUrl = raw.trim().replace(/\/$/, "");

  // Three distinct faults, each with its own fix. Reporting them as one
  // "invalid URL" sent the reader after the wrong thing once already: the
  // value was `http://:3001`, the protocol was fine, and the actual problem
  // was an unresolved Railway reference leaving the host empty.
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new WorkerError(
      `WORKER_URL غير صالح: «${baseUrl}» — ينقصه البروتوكول على الأرجح. ` +
        `المتوقّع http://<host>:3001`,
      0,
    );
  }

  if (!parsed.hostname) {
    throw new WorkerError(
      `WORKER_URL بلا مضيف: «${baseUrl}». ` +
        `غالباً مرجع ‎\${{…}}‎ لم يُحَل — تأكّد أن اسم الخدمة في المرجع مطابق ` +
        `لاسمها في Railway، أو انسخ الدومين الخاص مباشرة من ` +
        `worker ← Settings → Networking → Private Networking.`,
      0,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkerError(
      `WORKER_URL يستخدم بروتوكولاً غير مدعوم (${parsed.protocol}). المتوقّع http أو https.`,
      0,
    );
  }

  return { baseUrl, serviceKey };
}

async function request(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { baseUrl, serviceKey } = config();
  const { timeoutMs = 120_000, headers, ...rest } = init;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: { ...headers, "x-service-key": serviceKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Name the host. Node's fetch says only "fetch failed", which cannot
    // distinguish a wrong WORKER_URL from a worker that is down — and the
    // first is by far the more common mistake on a private network where the
    // hostname is derived from the service name.
    throw new WorkerError(
      `تعذّر الوصول إلى خدمة المعالجة على ${baseUrl} — ${describeError(e)}. ` +
        `تحقّق من WORKER_URL ومن أن خدمة worker تعمل.`,
      0,
    );
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => undefined);
    throw new WorkerError(detail ?? `فشل الاتصال بخدمة المعالجة (${res.status}).`, res.status);
  }
  return res;
}

export async function uploadSource(
  lessonId: string,
  filename: string,
  bytes: ArrayBuffer,
): Promise<{ key: string; bytes: number }> {
  const res = await request(`/upload?lessonId=${encodeURIComponent(lessonId)}`, {
    method: "POST",
    headers: { "x-filename": filename, "content-type": "application/octet-stream" },
    body: bytes,
    timeoutMs: 5 * 60 * 1000,
  });
  return res.json() as Promise<{ key: string; bytes: number }>;
}

export async function triggerStage(
  lessonId: string,
  stage: string,
  opts: { force?: boolean; requestedBy?: string } = {},
): Promise<void> {
  await request("/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lessonId, stage, ...opts }),
  });
}

export async function replyToDokie(lessonId: string, answer: string): Promise<void> {
  await request("/dokie/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lessonId, answer }),
    timeoutMs: 2 * 60 * 1000,
  });
}

/** Streams a stored object back for the signed-URL download route. */
export async function fetchObject(key: string): Promise<Response> {
  return request(`/object?key=${encodeURIComponent(key)}`, { timeoutMs: 10 * 60 * 1000 });
}

export async function workerHealth(): Promise<unknown> {
  const { baseUrl } = config();
  const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
  return res.json();
}

export interface Voice {
  id: string;
  name: string;
  description: string;
  previewUrl: string | null;
  supportsArabic: boolean;
}

/** Voice list for the settings picker — the key lives on the worker (§10). */
export async function listVoices(): Promise<{ voices: Voice[]; error?: string }> {
  try {
    const res = await request("/voices", { timeoutMs: 30_000 });
    return res.json() as Promise<{ voices: Voice[]; error?: string }>;
  } catch (e) {
    return { voices: [], error: e instanceof WorkerError ? e.message : "تعذّر الاتصال بخدمة المعالجة." };
  }
}

export type ProviderStatus = Record<string, boolean>;

/** Which provider keys are set. Booleans only — never the values. */
export async function providerStatus(): Promise<ProviderStatus> {
  try {
    const res = await request("/providers", { timeoutMs: 15_000 });
    return res.json() as Promise<ProviderStatus>;
  } catch {
    return {};
  }
}
