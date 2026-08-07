import { createLogger } from "./logger.js";

/**
 * Alerts on: terminal failure, dead Dokie session, budget block, self-test
 * failure (§9).
 *
 * Telegram messages are plain text with no RTL shaping, so every alert leads
 * with the Latin lesson code — an Arabic-first line renders with the code
 * displaced to the far end and becomes unscannable on a phone.
 */

const log = createLogger("telegram");

export type AlertKind =
  | "stage_failed"
  | "dokie_session_dead"
  | "budget_blocked"
  | "selftest_failed";

export interface Alert {
  kind: AlertKind;
  /** Human-readable lesson code, e.g. pmp-02-integration. */
  lessonCode?: string;
  lessonId?: string;
  stage?: string;
  message: string;
  url?: string;
}

const PREFIX: Record<AlertKind, string> = {
  stage_failed: "❌ فشل",
  dokie_session_dead: "🔑 جلسة Dokie",
  budget_blocked: "💰 توقف: الميزانية",
  selftest_failed: "🧪 فشل الفحص الذاتي",
};

export function formatAlert(alert: Alert): string {
  const head = alert.lessonCode ? `[${alert.lessonCode}] ` : "";
  const stage = alert.stage ? ` — ${alert.stage}` : "";
  const link = alert.url ? `\n${alert.url}` : "";
  return `${PREFIX[alert.kind]}${stage}\n${head}${alert.message}${link}`;
}

export async function sendAlert(alert: Alert): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    log.warn("telegram not configured, alert dropped", { kind: alert.kind });
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatAlert(alert),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Never log the response body — it echoes the bot token in some errors.
      log.error("telegram send failed", { kind: alert.kind, status: res.status });
      return false;
    }
    return true;
  } catch (e) {
    // An alerting failure must never take down the stage that was reporting.
    log.error("telegram send threw", { kind: alert.kind, error: e });
    return false;
  }
}
