"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  courses,
  getDb,
  lessons,
  lessonVersions,
  pronunciations,
} from "@course-prod/core/db";
import { createLogger } from "@course-prod/core/logger";
import { lessonJsonSchema, renumberSlides, type LessonJson } from "@course-prod/core/schema";
import { settingsSchema } from "@course-prod/core/settings";
import { loadSettings, saveSettings } from "@course-prod/core/settings-store";
import { rateLimit } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";
import { replyToDokie, triggerStage, uploadSource, WorkerError } from "@/lib/worker";

const log = createLogger("web.actions");

export interface ActionState {
  error?: string;
  ok?: string;
}

/* ── lessons ──────────────────────────────────────────────────────────── */

export async function createLesson(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  // §10 — rate-limit uploads per user.
  if (!rateLimit(`upload:${session.uid}`, 20, 3600).allowed) {
    return { error: "تجاوزت حد الرفع لهذه الساعة. حاول لاحقاً." };
  }

  const titleAr = String(formData.get("titleAr") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "").trim();
  const file = formData.get("file");

  if (!titleAr) return { error: "أدخل عنوان الدرس." };
  if (!courseId) return { error: "اختر الكورس." };
  if (!(file instanceof File) || file.size === 0) return { error: "اختر ملف المادة العلمية." };
  if (file.size > 50 * 1024 * 1024) {
    return { error: `الملف ${(file.size / 1024 / 1024).toFixed(0)} MB والحد 50 MB.` };
  }

  const db = getDb();
  const [lesson] = await db
    .insert(lessons)
    .values({ courseId, titleAr, status: "DRAFT", createdBy: session.uid })
    .returning({ id: lessons.id });

  if (!lesson) return { error: "تعذّر إنشاء الدرس." };

  try {
    await uploadSource(lesson.id, file.name, await file.arrayBuffer());
    await triggerStage(lesson.id, "INGEST", { requestedBy: session.uid });
  } catch (e) {
    // The lesson row exists but has no source; leaving it in DRAFT with the
    // reason attached is more useful than deleting it silently.
    const message = e instanceof WorkerError ? e.message : "تعذّر رفع الملف إلى خدمة المعالجة.";
    log.error("upload failed", { lesson_id: lesson.id, error: e });
    await db.update(lessons).set({ error: message }).where(eq(lessons.id, lesson.id));
    return { error: message };
  }

  log.info("lesson created", { lesson_id: lesson.id, user_id: session.uid });
  redirect(`/lessons/${lesson.id}`);
}

export async function runStage(formData: FormData): Promise<void> {
  const session = await requireSession();
  const lessonId = String(formData.get("lessonId") ?? "");
  const stage = String(formData.get("stage") ?? "");
  const force = formData.get("force") === "1";

  if (!lessonId || !stage) return;

  // §10 — export/generation triggers are rate-limited too; these cost money.
  if (!rateLimit(`stage:${session.uid}`, 60, 3600).allowed) return;

  await triggerStage(lessonId, stage, { force, requestedBy: session.uid });
  log.info("stage triggered", { lesson_id: lessonId, stage, force, user_id: session.uid });
  revalidatePath(`/lessons/${lessonId}`);
}

export async function answerDokie(formData: FormData): Promise<void> {
  await requireSession();
  const lessonId = String(formData.get("lessonId") ?? "");
  const answer = String(formData.get("answer") ?? "").trim();
  if (!lessonId || !answer) return;

  await replyToDokie(lessonId, answer);
  revalidatePath(`/lessons/${lessonId}`);
}

/* ── review ───────────────────────────────────────────────────────────── */

/**
 * Saves an edited lesson_json (§6.3).
 *
 * Every save re-validates against the full schema including the §4 invariant,
 * so a reorder that orphaned a narration entry cannot be persisted and
 * discovered three stages later.
 */
export async function saveLessonJson(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();
  const lessonId = String(formData.get("lessonId") ?? "");
  const raw = String(formData.get("lessonJson") ?? "");
  if (!lessonId) return { error: "درس غير معروف." };

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { error: "تعذّر قراءة التعديلات. أعد تحميل الصفحة وحاول مجدداً." };
  }

  const parsed = lessonJsonSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: `التعديلات غير صالحة — ${first?.path.join(".") ?? ""}: ${first?.message ?? ""}`,
    };
  }

  await getDb()
    .update(lessons)
    .set({ lessonJson: parsed.data, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId));

  revalidatePath(`/lessons/${lessonId}/review`);
  return { ok: "حُفظت المسودة." };
}

/**
 * §6.3 — approval writes REVIEWED and freezes the lesson by snapshotting it.
 * The snapshot is what any in-flight production run reads, so a later edit
 * creating version N+1 cannot change a deck that is already being generated.
 */
export async function approveLesson(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const lessonId = String(formData.get("lessonId") ?? "");
  if (!lessonId) return { error: "درس غير معروف." };

  const db = getDb();
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson?.lessonJson) return { error: "لا يوجد درس مُهيكل لاعتماده." };

  const parsed = lessonJsonSchema.safeParse(lesson.lessonJson);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: `لا يمكن الاعتماد — ${first?.path.join(".") ?? ""}: ${first?.message ?? ""}`,
    };
  }

  await db
    .insert(lessonVersions)
    .values({
      lessonId,
      version: lesson.lessonVersion,
      lessonJson: parsed.data,
      approvedBy: session.uid,
    })
    .onConflictDoNothing();

  await db
    .update(lessons)
    .set({ status: "REVIEWED", error: null, errorCode: null, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId));

  log.info("lesson approved", {
    lesson_id: lessonId,
    version: lesson.lessonVersion,
    user_id: session.uid,
  });
  redirect(`/lessons/${lessonId}`);
}

/** Reordering renumbers slides and moves narration + quiz refs together (§6.3). */
export async function reorderSlides(
  lessonId: string,
  orderedSlideIds: string[],
): Promise<ActionState> {
  await requireSession();
  const db = getDb();
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson?.lessonJson) return { error: "لا يوجد درس مُهيكل." };

  const current = lesson.lessonJson as LessonJson;
  const bySlideId = new Map(current.slides.map((s) => [s.id, s]));
  const reordered = orderedSlideIds.map((id) => bySlideId.get(id)).filter(Boolean);

  if (reordered.length !== current.slides.length) {
    return { error: "ترتيب غير مكتمل. أعد تحميل الصفحة." };
  }

  const next = renumberSlides({ ...current, slides: reordered as LessonJson["slides"] });
  const parsed = lessonJsonSchema.safeParse(next);
  if (!parsed.success) return { error: "أدى الترتيب الجديد إلى درس غير صالح." };

  await db
    .update(lessons)
    .set({ lessonJson: parsed.data, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId));

  revalidatePath(`/lessons/${lessonId}/review`);
  return { ok: "أُعيد الترتيب." };
}

/* ── courses ──────────────────────────────────────────────────────────── */

export async function createCourse(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const titleAr = String(formData.get("titleAr") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const targetMarket = String(formData.get("targetMarket") ?? "EG");

  if (!titleAr || !code) return { error: "أدخل عنوان الكورس وكوده." };
  if (!["EG", "KSA", "GULF"].includes(targetMarket)) return { error: "سوق غير معروف." };

  try {
    await getDb()
      .insert(courses)
      .values({
        titleAr,
        code,
        targetMarket: targetMarket as "EG" | "KSA" | "GULF",
        createdBy: session.uid,
      });
  } catch {
    return { error: `الكود «${code}» مستخدم بالفعل في كورس آخر.` };
  }

  revalidatePath("/lessons/new");
  return { ok: "أُضيف الكورس." };
}

/* ── dictionary ───────────────────────────────────────────────────────── */

export async function saveTerm(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const term = String(formData.get("term") ?? "").trim();
  const replacement = String(formData.get("replacement") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  const courseId = String(formData.get("courseId") ?? "").trim();
  const scope = courseId ? "course" : "global";

  if (!term) return { error: "أدخل المصطلح." };
  if (!replacement) return { error: "البديل مطلوب. اتركه مطابقاً للمصطلح إن أردت التشكيل فقط." };

  const db = getDb();
  try {
    if (id) {
      await db
        .update(pronunciations)
        .set({ term, replacement, note, scope, courseId: courseId || null, updatedBy: session.uid, updatedAt: new Date() })
        .where(eq(pronunciations.id, id));
    } else {
      await db.insert(pronunciations).values({
        term,
        replacement,
        note,
        scope,
        courseId: courseId || null,
        updatedBy: session.uid,
      });
    }
  } catch {
    return { error: `«${term}» موجود بالفعل في هذا النطاق. عدّل المصطلح الحالي بدل إضافة نسخة ثانية.` };
  }

  revalidatePath("/dictionary");
  return {
    ok: "حُفظ المصطلح. يُطبَّق على السرد المولَّد بعد الآن — السرد الموجود لا يتغيّر.",
  };
}

export async function deleteTerm(formData: FormData): Promise<void> {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await getDb().delete(pronunciations).where(eq(pronunciations.id, id));
  revalidatePath("/dictionary");
}

/* ── settings ─────────────────────────────────────────────────────────── */

export async function updateSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { error: "الإعدادات متاحة للمسؤولين فقط." };

  const current = await loadSettings();
  const patch: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (!(key in current)) continue;
    const currentValue = (current as Record<string, unknown>)[key];
    if (typeof currentValue === "number") patch[key] = Number(value);
    else if (typeof currentValue === "boolean") patch[key] = value === "on" || value === "true";
    else patch[key] = String(value);
  }

  const parsed = settingsSchema.partial().safeParse(patch);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: `إعداد غير صالح — ${first?.path.join(".") ?? ""}: ${first?.message ?? ""}` };
  }

  await saveSettings(parsed.data, session.uid);
  revalidatePath("/settings");
  return { ok: "حُفظت الإعدادات." };
}

// Note: a "use server" module may only export async functions. Data-fetching
// helpers live in lib/queries.ts rather than here, so they are plain server
// calls instead of being compiled into callable server actions.
