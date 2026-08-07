import { sendAlert } from "@course-prod/core";
import { createLogger } from "@course-prod/core/logger";
import { exportDeck } from "./exporters/index.js";

const log = createLogger("self-test");

/**
 * §6.5 — export a known project and report pass/fail.
 *
 * The point is timing: run daily on a cron, this discovers a Dokie redesign
 * before a producer hits it mid-deadline. Without it, the first sign of a
 * broken exporter is a failed lesson at the worst possible moment.
 */

export interface SelfTestResult {
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  projectUrl?: string;
  bytes?: number;
  error?: string;
}

export async function runSelfTest(alertOnFailure = true): Promise<SelfTestResult> {
  const projectUrl = process.env.DOKIE_SELFTEST_PROJECT_URL;
  const startedAt = Date.now();

  if (!projectUrl) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: 0,
      error:
        "لم يُضبط DOKIE_SELFTEST_PROJECT_URL. اضبطه على رابط مشروع Dokie مكتمل ليعمل الفحص اليومي.",
    };
  }

  try {
    const buffer = await exportDeck(projectUrl, "pptx");
    const result: SelfTestResult = {
      ok: true,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      projectUrl,
      bytes: buffer.byteLength,
    };
    log.info("self-test passed", { bytes: buffer.byteLength, ms: result.durationMs });
    return result;
  } catch (e) {
    const error = (e as Error).message;
    log.error("self-test failed", { error });

    if (alertOnFailure) {
      await sendAlert({
        kind: "selftest_failed",
        message:
          `فشل الفحص اليومي لتصدير Dokie: ${error}\n` +
          `الأرجح أن تصميم Dokie تغيّر — راجع config/dokie-selectors.ts.`,
      });
    }

    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      projectUrl,
      error,
    };
  }
}
