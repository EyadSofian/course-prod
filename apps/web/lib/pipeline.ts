import type { LessonStatus, Stage } from "@course-prod/core/stages";

/**
 * One model of the production path, shared by every screen.
 *
 * The interface previously had two: the board drew seven queue stages, the
 * lesson page drew the same seven, and neither showed the approval that has to
 * happen between structuring and deck generation. A producer saw
 * "هيكلة الدرس ✓" followed by a deck step with no button and no explanation,
 * because the lesson was sitting at SUMMARIZED and DECK only unlocks at
 * REVIEWED. The gate existed in the state machine and nowhere on screen.
 *
 * So the path here is eight steps, not seven: the human gate is a step like
 * any other. And `nextAction` is the single answer to "what do I do now",
 * which every screen renders instead of each deciding for itself.
 */

export type StepId = Stage | "REVIEW";

export interface Step {
  id: StepId;
  label: string;
  icon: string;
  /** A queue stage the worker runs, or the human gate. */
  kind: "stage" | "gate";
  /** Spends money with a third party. */
  billable: boolean;
  hint: string;
}

export const PIPELINE: Step[] = [
  { id: "INGEST", label: "استخراج النص", icon: "◫", kind: "stage", billable: false,
    hint: "قراءة الملف واستخراج نصّه" },
  { id: "SUMMARIZE", label: "هيكلة الدرس", icon: "❖", kind: "stage", billable: true,
    hint: "تحويل المادة إلى شرائح وسرد وأسئلة" },
  { id: "REVIEW", label: "مراجعتك واعتمادك", icon: "✓", kind: "gate", billable: false,
    hint: "لا شيء يعمل تلقائياً قبل اعتمادك" },
  { id: "DECK", label: "توليد العرض", icon: "▤", kind: "stage", billable: true,
    hint: "بناء العرض التقديمي في Dokie" },
  { id: "EXPORT", label: "تصدير الملفات", icon: "⬓", kind: "stage", billable: false,
    hint: "تنزيل PPTX وتحويله لـ PDF وصور" },
  { id: "NARRATE", label: "توليد السرد", icon: "◍", kind: "stage", billable: true,
    hint: "مقطع صوتي لكل شريحة" },
  { id: "ASSEMBLE", label: "تجميع الفيديو", icon: "▶", kind: "stage", billable: false,
    hint: "دمج الشرائح مع الصوت" },
  { id: "PUBLISH", label: "نشر الحزمة", icon: "✦", kind: "stage", billable: false,
    hint: "تجهيز الحزمة للتسليم" },
];

/**
 * How far along a status is. Ordered so "step i is done" is a comparison
 * rather than a lookup table that has to be kept in sync by hand.
 */
const RANK: Record<LessonStatus, number> = {
  DRAFT: 0,
  INGESTED: 1,
  SUMMARIZED: 2,
  REVIEWED: 3,
  DECK_READY: 4,
  DECK_EXPORTED: 5,
  NARRATED: 6,
  ASSEMBLED: 7,
  PUBLISHED: 8,
  // A stopped lesson keeps whatever progress it had; the step that stopped it
  // is derived from its stage runs, not from the status.
  FAILED: -1,
  BLOCKED_BUDGET: -1,
};

export function rankOf(status: LessonStatus): number {
  return RANK[status];
}

export type StepState = "done" | "current" | "todo" | "stopped";

export function stepStates(
  status: LessonStatus,
  stoppedAtIndex: number | null,
): StepState[] {
  const rank = rankOf(status);

  return PIPELINE.map((_, i) => {
    if (stoppedAtIndex !== null) {
      if (i === stoppedAtIndex) return "stopped";
      return i < stoppedAtIndex ? "done" : "todo";
    }
    if (rank < 0) return "todo";
    if (i < rank) return "done";
    if (i === rank) return "current";
    return "todo";
  });
}

export interface NextAction {
  /** Short imperative for the primary button. */
  label: string;
  /** Navigate here, or trigger this stage — never both. */
  href?: string;
  stage?: Stage;
  /** Force past the entry-status guard (recovery from a stopped lesson). */
  force?: boolean;
  tone: "primary" | "warn" | "done";
  /** One line explaining why this is next. */
  why: string;
}

/**
 * The single answer to "what happens now", for one lesson.
 *
 * Every screen asks this rather than re-deriving it, so the board card, the
 * lesson header and the timeline can never disagree about what the producer
 * is supposed to do.
 */
export function nextAction(lesson: {
  id: string;
  status: LessonStatus;
  dokiePendingQuestion: string | null;
}): NextAction {
  const to = (p: string) => `/lessons/${lesson.id}${p}`;

  if (lesson.dokiePendingQuestion) {
    return {
      label: "ردّ على سؤال Dokie",
      href: to(""),
      tone: "warn",
      why: "Dokie تطلب تأكيد المخطط قبل أن تبدأ التوليد.",
    };
  }

  switch (lesson.status) {
    case "BLOCKED_BUDGET":
      return {
        label: "راجع الميزانية",
        href: "/settings",
        tone: "warn",
        why: "التشغيل يتجاوز سقف الشهر، فتوقّف قبل أن يصرف.",
      };
    case "FAILED":
      return {
        label: "أعد المحاولة",
        href: to(""),
        tone: "warn",
        why: "تعثّرت إحدى المراحل. افتح السجل ثم أعد تشغيلها.",
      };
    case "DRAFT":
      return { label: "استخرج النص", stage: "INGEST", tone: "primary", why: "المادة مرفوعة ولم تُقرأ بعد." };
    case "INGESTED":
      return { label: "هيكل الدرس", stage: "SUMMARIZE", tone: "primary", why: "النص جاهز للتحويل إلى درس." };
    case "SUMMARIZED":
      return {
        label: "افتح المراجعة",
        href: to("/review"),
        tone: "warn",
        why: "الدرس جاهز لمراجعتك. لا شيء يتقدّم قبل اعتمادك.",
      };
    case "REVIEWED":
      return { label: "ولّد العرض", stage: "DECK", tone: "primary", why: "الدرس معتمَد ويمكن بدء الإنتاج." };
    case "DECK_READY":
      return { label: "صدّر الملفات", stage: "EXPORT", tone: "primary", why: "العرض جاهز في Dokie ويحتاج تنزيلاً." };
    case "DECK_EXPORTED":
      return { label: "ولّد السرد", stage: "NARRATE", tone: "primary", why: "الشرائح جاهزة وتنتظر الصوت." };
    case "NARRATED":
      return { label: "جمّع الفيديو", stage: "ASSEMBLE", tone: "primary", why: "الصوت والشرائح جاهزان للدمج." };
    case "ASSEMBLED":
      return { label: "انشر الحزمة", stage: "PUBLISH", tone: "primary", why: "الفيديو جاهز والحزمة تنتظر التجهيز." };
    case "PUBLISHED":
      return { label: "نزّل الحزمة", href: to(""), tone: "done", why: "الدرس مكتمل وجاهز للتسليم." };
  }
}
