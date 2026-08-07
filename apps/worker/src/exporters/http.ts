import { createLogger } from "@course-prod/core/logger";
import { RetryableError, TerminalError } from "@course-prod/core/stages";
import type { DokieExportEndpoint } from "../config/dokie-selectors.js";
import type { DeckExporter, ExportFormat } from "./index.js";

const log = createLogger("export.http");

/**
 * The preferred strategy (§6.5): a direct call to the endpoint discovered in
 * Phase 0, with no browser involved at all.
 *
 * Auth order is from the spec — try the MCP Personal Access Token as the
 * bearer first, and fall back to a stored session credential only on 401.
 */
export class HttpExporter implements DeckExporter {
  readonly name = "http";

  constructor(private readonly endpoint: DokieExportEndpoint) {}

  async export(projectUrl: string, format: ExportFormat): Promise<Buffer> {
    const projectId = extractProjectId(projectUrl);

    const withPat = await this.attempt(projectId, format, process.env.DOKIE_API_KEY);
    if (withPat.status !== 401 && withPat.status !== 403) {
      return this.finish(withPat, format);
    }

    log.warn("PAT rejected for export, falling back to session credential");
    const sessionToken = process.env.DOKIE_SESSION_TOKEN;
    if (!sessionToken) {
      throw new TerminalError(
        "رفضت Dokie مفتاح الـ PAT للتصدير ولا يوجد اعتماد جلسة مخزّن. " +
          "سجّل الدخول من الإعدادات ← Dokie.",
        "AUTH_FAILURE",
      );
    }

    const withSession = await this.attempt(projectId, format, sessionToken);
    if (withSession.status === 401 || withSession.status === 403) {
      throw new TerminalError(
        "جلسة Dokie منتهية. سجّل الدخول من الإعدادات ← Dokie ثم أعد المحاولة.",
        "AUTH_FAILURE",
      );
    }
    return this.finish(withSession, format);
  }

  private async attempt(
    projectId: string,
    format: ExportFormat,
    token: string | undefined,
  ): Promise<Response> {
    const url = this.endpoint.urlTemplate
      .replace("{projectId}", encodeURIComponent(projectId))
      .replace("{format}", format);

    const headers: Record<string, string> = { ...this.endpoint.headers };
    if (token) headers.Authorization = `Bearer ${token}`;

    const body = this.endpoint.bodyTemplate
      ?.replace("{projectId}", projectId)
      .replace("{format}", format);

    try {
      return await fetch(url, {
        method: this.endpoint.method,
        headers,
        body,
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
    } catch (e) {
      throw new RetryableError(`تعذّر الوصول إلى نقطة تصدير Dokie: ${(e as Error).message}`);
    }
  }

  private async finish(res: Response, format: ExportFormat): Promise<Buffer> {
    if (res.status === 429) throw new RetryableError("خدمة Dokie مزدحمة.", 30_000);
    if (res.status >= 500) throw new RetryableError(`خطأ من خادم Dokie (${res.status}).`);
    if (!res.ok) {
      throw new TerminalError(
        `فشل التصدير من Dokie (${res.status}). قد تكون نقطة التصدير تغيّرت — ` +
          `أعد تشغيل مرحلة الاكتشاف وحدّث config/dokie-selectors.ts.`,
        "SELECTOR_NOT_FOUND",
      );
    }

    if (this.endpoint.responseType === "binary") {
      return Buffer.from(await res.arrayBuffer());
    }

    // signed-url / async-job: the response points at the file rather than
    // being the file.
    const json = (await res.json()) as Record<string, unknown>;
    const url = this.endpoint.urlJsonPath
      ? String(readPath(json, this.endpoint.urlJsonPath) ?? "")
      : String(json.url ?? json.download_url ?? "");

    if (!url) {
      throw new TerminalError(
        "لم تُرجع Dokie رابط تنزيل في الاستجابة. تحقّق من docs/dokie-export.md.",
        "SELECTOR_NOT_FOUND",
        { response: JSON.stringify(json).slice(0, 1_000) },
      );
    }

    const file = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!file.ok) {
      throw new RetryableError(`تعذّر تنزيل الملف المُصدَّر (${file.status}).`);
    }
    log.info("exported via signed url", { format });
    return Buffer.from(await file.arrayBuffer());
  }
}

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function extractProjectId(projectUrl: string): string {
  const match = projectUrl.match(/\/([A-Za-z0-9_-]{6,})\/?(?:\?|#|$)/);
  if (!match?.[1]) {
    throw new TerminalError(
      `تعذّر استخراج معرّف المشروع من الرابط: ${projectUrl}`,
      "SELECTOR_NOT_FOUND",
    );
  }
  return match[1];
}
