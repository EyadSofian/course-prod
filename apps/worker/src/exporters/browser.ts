import { mkdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { getWorkerEnv } from "@course-prod/core";
import { createLogger } from "@course-prod/core/logger";
import { TerminalError } from "@course-prod/core/stages";
import { DOKIE_SELECTORS, SHOTS_SUBDIR } from "../config/dokie-selectors.js";
import type { DeckExporter, ExportFormat } from "./index.js";

const log = createLogger("export.browser");

/**
 * Fallback strategy (§6.5): drive the real UI with Playwright.
 *
 * Session state persists to /data/dokie-state.json so a normal export needs no
 * login at all. On a login redirect: re-login once, save state, retry once,
 * then fail — never a loop, because a genuinely wrong credential would
 * otherwise hammer their login endpoint.
 */
export class BrowserExporter implements DeckExporter {
  readonly name = "browser";

  async export(projectUrl: string, format: ExportFormat): Promise<Buffer> {
    const env = getWorkerEnv();
    const statePath = join(env.STATE_DIR, "dokie-state.json");
    const shotsDir = join(env.STATE_DIR, SHOTS_SUBDIR);
    await mkdir(shotsDir, { recursive: true });

    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    try {
      let context = await this.newContext(browser, statePath);
      let page = await context.newPage();

      try {
        await page.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

        if (await this.isLoginPage(page)) {
          log.warn("session dead, logging in once");
          await this.login(page);
          await context.storageState({ path: statePath });
          await page.goto(projectUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

          if (await this.isLoginPage(page)) {
            throw new TerminalError(
              "جلسة Dokie منتهية وفشل تسجيل الدخول التلقائي. " +
                "تحقّق من DOKIE_EMAIL و DOKIE_PASSWORD، أو سجّل الدخول يدوياً.",
              "AUTH_FAILURE",
            );
          }
        }

        const buffer = await this.clickExport(page, format);
        // Refresh stored state on success so a rotated cookie is kept.
        await context.storageState({ path: statePath });
        return buffer;
      } catch (e) {
        const shot = join(shotsDir, `export-${Date.now()}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        log.error("export failed, screenshot saved", { screenshot: shot });

        if (e instanceof TerminalError) {
          // Attach the screenshot path so stage_runs.log points at it (§6.5).
          throw new TerminalError(e.message, e.code, { ...(e.detail as object), screenshot: shot });
        }
        throw new TerminalError(
          `فشل تصدير العرض من متصفح Dokie: ${(e as Error).message}`,
          "SELECTOR_NOT_FOUND",
          { screenshot: shot },
        );
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  private async newContext(browser: Browser, statePath: string): Promise<BrowserContext> {
    const hasState = await access(statePath).then(
      () => true,
      () => false,
    );
    return browser.newContext({
      storageState: hasState ? statePath : undefined,
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      locale: "ar",
    });
  }

  private async isLoginPage(page: Page): Promise<boolean> {
    if (/\/login|\/signin|\/auth/i.test(page.url())) return true;
    // A visible password field is a more reliable signal than the URL, which
    // may not change on a client-side redirect.
    return page
      .getByLabel(DOKIE_SELECTORS.passwordField)
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
  }

  private async login(page: Page): Promise<void> {
    const email = process.env.DOKIE_EMAIL;
    const password = process.env.DOKIE_PASSWORD;
    if (!email || !password) {
      throw new TerminalError(
        "جلسة Dokie منتهية ولا توجد بيانات دخول مخزّنة (DOKIE_EMAIL / DOKIE_PASSWORD).",
        "AUTH_FAILURE",
      );
    }

    if (!/\/login|\/signin/i.test(page.url())) {
      await page.goto(DOKIE_SELECTORS.loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }

    await page.getByLabel(DOKIE_SELECTORS.emailField).first().fill(email);
    await page.getByLabel(DOKIE_SELECTORS.passwordField).first().fill(password);
    await page
      .getByRole("button", { name: DOKIE_SELECTORS.submitButton })
      .first()
      .click();

    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  }

  /** Controls by role and accessible name only — never CSS class (§6.5). */
  private async clickExport(page: Page, format: ExportFormat): Promise<Buffer> {
    const exportControl = page
      .getByRole("button", { name: DOKIE_SELECTORS.exportButton })
      .or(page.getByRole("link", { name: DOKIE_SELECTORS.exportButton }))
      .first();

    if (!(await exportControl.isVisible({ timeout: 30_000 }).catch(() => false))) {
      throw new TerminalError(
        "لم نعثر على زر التصدير في صفحة Dokie. الأرجح أنهم غيّروا تصميم الموقع. " +
          "يحتاج الأمر تحديث config/dokie-selectors.ts من الفريق التقني.",
        "SELECTOR_NOT_FOUND",
      );
    }

    // The download may start on the first click, or after choosing a format
    // from a menu. Arm the listener before either.
    const downloadPromise = page.waitForEvent("download", { timeout: 5 * 60 * 1000 });
    await exportControl.click();

    const formatOption = page
      .getByRole("menuitem", {
        name: format === "pptx" ? DOKIE_SELECTORS.pptxOption : DOKIE_SELECTORS.pdfOption,
      })
      .or(
        page.getByRole("button", {
          name: format === "pptx" ? DOKIE_SELECTORS.pptxOption : DOKIE_SELECTORS.pdfOption,
        }),
      )
      .first();

    if (await formatOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await formatOption.click();
    }

    const download = await downloadPromise;
    const path = await download.path();
    if (!path) {
      throw new TerminalError("فشل تنزيل الملف من Dokie.", "SELECTOR_NOT_FOUND");
    }

    log.info("download captured", { suggested: download.suggestedFilename() });
    return readFile(path);
  }
}
