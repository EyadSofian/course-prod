/**
 * Every Dokie UI selector lives here (§6.5) so a redesign on their side is a
 * one-file fix rather than a hunt through the exporter.
 *
 * Controls are matched by role and accessible name, never by CSS class —
 * class names are build artefacts that change without notice, whereas an
 * export button that stops being labelled "export" has stopped being an
 * export button.
 *
 * The daily /self-test exercises these against a known project so a redesign
 * is discovered by a cron job rather than by a producer mid-deadline.
 */

export interface DokieSelectors {
  loginUrl: string;
  emailField: RegExp;
  passwordField: RegExp;
  submitButton: RegExp;
  /** Present only when authenticated — used to detect a dead session. */
  loggedInMarker: RegExp;
  exportButton: RegExp;
  /** Format choice inside the export menu, if one appears. */
  pptxOption: RegExp;
  pdfOption: RegExp;
  /** Shown while the export is being prepared server-side. */
  preparingIndicator: RegExp;
}

export const DOKIE_SELECTORS: DokieSelectors = {
  loginUrl: "https://dokie.ai/login",

  emailField: /email|e-?mail|البريد/i,
  passwordField: /password|كلمة\s*المرور/i,
  submitButton: /sign\s*in|log\s*in|login|تسجيل\s*الدخول|دخول/i,
  loggedInMarker: /dashboard|projects|my\s*decks|لوحة|المشاريع/i,

  exportButton: /export|download|تصدير|تنزيل|تحميل/i,
  pptxOption: /pptx|powerpoint|ppt\b/i,
  pdfOption: /\bpdf\b/i,
  preparingIndicator: /preparing|generating|exporting|جارٍ|جاري/i,
};

/** Where a failure screenshot goes; the path is attached to stage_runs.log. */
export const SHOTS_SUBDIR = "shots";

/**
 * Phase 0 (§6.5) has not been run yet, so the HTTP exporter has no endpoint to
 * call. Filling this in from docs/dokie-export.md turns off the browser
 * fallback and makes export a plain HTTP request with no Playwright at all.
 */
export interface DokieExportEndpoint {
  urlTemplate: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  bodyTemplate?: string;
  /** How the file comes back: inline bytes, or a URL to follow. */
  responseType: "binary" | "signed-url" | "async-job";
  /** For signed-url / async-job, where the URL sits in the JSON response. */
  urlJsonPath?: string;
}

export const DOKIE_EXPORT_ENDPOINT: DokieExportEndpoint | null = null;
