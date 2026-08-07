import type { LessonStatus } from "@course-prod/core";

/**
 * Every user-facing string lives here, mirroring docs/ux-copy.ar.md. One term
 * per concept — deviating from the glossary is a bug, not a style choice.
 *
 * Western numerals throughout, including inside Arabic sentences: slide ids are
 * s01..sNN and costs are USD, and mixing digit systems in one table row is
 * unscannable.
 */

export const app = {
  name: "داشبورد إنتاج الكورسات",
  org: "إنجوسوفت",
};

export const nav = {
  board: "لوحة الإنتاج",
  newLesson: "درس جديد",
  dictionary: "قاموس النطق",
  settings: "الإعدادات",
  signOut: "تسجيل الخروج",
};

export const auth = {
  title: "تسجيل الدخول",
  email: "البريد الإلكتروني",
  password: "كلمة المرور",
  submit: "تسجيل الدخول",
  submitting: "جارٍ تسجيل الدخول…",
  // One string for both cases — never distinguish unknown email from wrong password.
  invalid: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  rateLimited: "محاولات كثيرة. أعد المحاولة بعد 5 دقائق.",
  expired: "انتهت الجلسة. سجّل الدخول للمتابعة.",
  noSignup: "الحسابات يُنشئها المسؤول. تواصل مع مسؤول النظام.",
  missingFields: "أدخل البريد الإلكتروني وكلمة المرور.",
};

/** Chip labels — where a lesson *is*. Kanban columns use COLUMNS below. */
export const statusLabel: Record<LessonStatus, string> = {
  DRAFT: "مسودة",
  INGESTED: "النص جاهز",
  SUMMARIZED: "بانتظار المراجعة",
  REVIEWED: "معتمَد",
  DECK_READY: "العرض جاهز",
  DECK_EXPORTED: "الملفات مصدَّرة",
  NARRATED: "السرد جاهز",
  ASSEMBLED: "الفيديو جاهز",
  PUBLISHED: "منشور",
  FAILED: "متعثّر",
  BLOCKED_BUDGET: "موقوف: الميزانية",
};

export const stageLabel = {
  INGEST: "استخراج النص",
  SUMMARIZE: "هيكلة الدرس",
  DECK: "توليد العرض",
  EXPORT: "تصدير الملفات",
  NARRATE: "توليد السرد",
  ASSEMBLE: "تجميع الفيديو",
  PUBLISH: "نشر الحزمة",
} as const;

/**
 * 8 columns, not 9: DECK_READY/DECK_EXPORTED and INGESTED are machine
 * transitions nobody acts on. Columns are named by what is needed next.
 */
export const COLUMNS: { id: string; label: string; statuses: LessonStatus[]; gate?: boolean; stopped?: boolean }[] = [
  { id: "draft", label: "مسودة", statuses: ["DRAFT"] },
  { id: "preparing", label: "جارٍ التحضير", statuses: ["INGESTED"] },
  { id: "review", label: "بانتظار المراجعة", statuses: ["SUMMARIZED"], gate: true },
  { id: "ready", label: "جاهز للإنتاج", statuses: ["REVIEWED"] },
  { id: "producing", label: "جارٍ الإنتاج", statuses: ["DECK_READY", "DECK_EXPORTED", "NARRATED"] },
  { id: "publishable", label: "جاهز للنشر", statuses: ["ASSEMBLED"] },
  { id: "published", label: "منشور", statuses: ["PUBLISHED"] },
  { id: "stopped", label: "متوقف", statuses: ["FAILED", "BLOCKED_BUDGET"], stopped: true },
];

export const board = {
  title: "لوحة الإنتاج",
  empty: "لا توجد دروس بعد. ارفع أول مادة علمية لبدء خط الإنتاج.",
  emptyCta: "رفع مادة جديدة",
  lastUpdated: "آخر تحديث",
};

export const actions = {
  upload: "رفع المادة وبدء الاستخراج",
  summarize: "هيكلة الدرس",
  approve: "اعتماد الدرس",
  saveDraft: "حفظ المسودة",
  generateDeck: "توليد العرض",
  exportFiles: "تصدير الملفات",
  narrate: "توليد السرد",
  assemble: "تجميع الفيديو",
  publish: "نشر الحزمة",
  downloadPackage: "تنزيل الحزمة الكاملة",
  // Free. Only ever shown on a failed stage.
  retry: "إعادة المحاولة",
  // Costs money. Only ever shown on a succeeded stage, always behind a confirm.
  regenerate: "إعادة التوليد",
  viewLog: "عرض السجل",
  cancel: "إلغاء",
  back: "رجوع",
};

export const cost = {
  panel: "التكلفة",
  claude: "Claude — الهيكلة",
  elevenlabs: "ElevenLabs — السرد",
  dokie: "Dokie — الرصيد (تقديري)",
  lessonTotal: "إجمالي الدرس",
  monthly: (spent: string, cap: string) => `مصروف الشهر: ${spent} من ${cap}`,
  dokieFootnote: "تقديري — Dokie لا يوفّر التكلفة الفعلية عبر الـ API.",
  free: "مجانية",
  none: (cap: string) => `لا مصروف هذا الشهر بعد. السقف الحالي ${cap}.`,
};

export const health = {
  ok: "سليم",
  degraded: "متدهور",
  down: "متوقف",
};

/**
 * Arabic dual/plural. `${n} شريحة` is wrong at 2 and at 3–10, and hand-writing
 * this at each call site guarantees drift.
 */
export function pluralAr(
  n: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

export const slides = (n: number) =>
  pluralAr(n, { one: "شريحة واحدة", two: "شريحتان", few: "شرائح", many: "شريحة" });

export const clips = (n: number) =>
  pluralAr(n, { one: "مقطع واحد", two: "مقطعان", few: "مقاطع", many: "مقطعاً" });

export const questions = (n: number) =>
  pluralAr(n, { one: "سؤال واحد", two: "سؤالان", few: "أسئلة", many: "سؤالاً" });

export const lessons = (n: number) =>
  pluralAr(n, { one: "درس واحد", two: "درسان", few: "دروس", many: "درساً" });

/** Relative time, Arabic, coarse — an operator does not need "منذ 47 ثانية". */
export function relativeTime(date: Date | string): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}
