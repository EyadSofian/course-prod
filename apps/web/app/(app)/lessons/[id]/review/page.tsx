import { notFound, redirect } from "next/navigation";
import type { LessonJson } from "@course-prod/core/schema";
import { getLesson } from "@/lib/queries";
import { fetchObject } from "@/lib/worker";
import { ReviewEditor } from "./editor";

export const dynamic = "force-dynamic";

/**
 * §6.3 — split screen: extracted source text on one side, generated
 * lesson_json on the other.
 *
 * This is the human gate. Nothing advances past it automatically (§5), which
 * makes it the one screen where being slow and explicit beats being slick.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getLesson(id);
  if (!row) notFound();

  const { lesson } = row;
  if (!lesson.lessonJson) redirect(`/lessons/${id}`);

  // The source text lives on the worker's volume, so it comes back through the
  // worker's private surface rather than off local disk.
  // Kept apart from the text itself: the previous version assigned the error
  // message to sourceText, so the header cheerfully reported "41 حرف" — the
  // length of its own failure notice — and swallowed the reason entirely.
  let sourceText = "";
  let sourceError: string | null = null;

  if (!lesson.sourceTextKey) {
    sourceError = "لم يُستخرج النص بعد. شغّل مرحلة استخراج النص أولاً.";
  } else {
    try {
      const res = await fetchObject(lesson.sourceTextKey);
      sourceText = await res.text();
    } catch (e) {
      sourceError = e instanceof Error ? e.message : "تعذّر تحميل النص المصدر.";
    }
  }

  return (
    <ReviewEditor
      lessonId={id}
      titleAr={lesson.titleAr}
      courseTitle={row.courseTitle ?? ""}
      status={lesson.status}
      version={lesson.lessonVersion}
      sourceText={sourceText}
      sourceError={sourceError}
      lessonJson={lesson.lessonJson as LessonJson}
    />
  );
}
