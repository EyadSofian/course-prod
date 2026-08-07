import { createLogger } from "@course-prod/core/logger";
import { TerminalError } from "@course-prod/core/stages";
import { DOKIE_EXPORT_ENDPOINT } from "../config/dokie-selectors.js";
import { HttpExporter } from "./http.js";
import { BrowserExporter } from "./browser.js";

const log = createLogger("export");

export type ExportFormat = "pptx" | "pdf";

/** §6.5 — two strategies behind one interface. */
export interface DeckExporter {
  readonly name: string;
  export(projectUrl: string, format: ExportFormat): Promise<Buffer>;
}

/**
 * Exports are serialised process-wide (§6.5): one at a time.
 *
 * The browser exporter shares a single persisted storageState file, so two
 * concurrent exports race on it and can invalidate each other's session. The
 * HTTP exporter does not need this, but the mutex sits here rather than inside
 * BrowserExporter so the guarantee holds whichever strategy is selected.
 */
let chain: Promise<unknown> = Promise.resolve();

export function withExportLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  // Keep the chain alive regardless of outcome, without leaking rejections.
  chain = run.catch(() => {});
  return run;
}

/**
 * HttpExporter is preferred and is the production path once Phase 0 has
 * identified the endpoint (§6.5). Until then it has nothing to call, and the
 * browser is the only route.
 */
export function selectExporter(): DeckExporter {
  if (DOKIE_EXPORT_ENDPOINT) {
    log.info("using http exporter");
    return new HttpExporter(DOKIE_EXPORT_ENDPOINT);
  }
  log.info("using browser exporter (Phase 0 endpoint not configured)");
  return new BrowserExporter();
}

export async function exportDeck(projectUrl: string, format: ExportFormat): Promise<Buffer> {
  const exporter = selectExporter();
  return withExportLock(async () => {
    const buffer = await exporter.export(projectUrl, format);
    assertLooksLike(buffer, format, exporter.name);
    return buffer;
  });
}

/**
 * A login page returned with a 200 is the classic silent export failure: the
 * bytes arrive, the file is written, and the corruption only surfaces when
 * LibreOffice fails to convert it. Checking magic bytes catches it here, where
 * the error can still name the cause.
 */
function assertLooksLike(buffer: Buffer, format: ExportFormat, exporterName: string): void {
  if (buffer.byteLength < 1024) {
    throw new TerminalError(
      `الملف المُصدَّر صغير جداً (${buffer.byteLength} بايت) — على الأرجح صفحة خطأ وليس عرضاً.`,
      "SELECTOR_NOT_FOUND",
      { exporter: exporterName },
    );
  }

  const head = buffer.subarray(0, 4);
  if (format === "pptx") {
    // PPTX is a zip: "PK\x03\x04".
    if (!(head[0] === 0x50 && head[1] === 0x4b)) {
      throw new TerminalError(
        "الملف المُصدَّر ليس ملف PPTX صالحاً. غالباً أعادت Dokie صفحة تسجيل دخول بدل الملف.",
        "SELECTOR_NOT_FOUND",
        { exporter: exporterName, head: head.toString("hex") },
      );
    }
  } else if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new TerminalError(
      "الملف المُصدَّر ليس ملف PDF صالحاً.",
      "SELECTOR_NOT_FOUND",
      { exporter: exporterName, head: head.toString("hex") },
    );
  }
}

export { HttpExporter, BrowserExporter };
