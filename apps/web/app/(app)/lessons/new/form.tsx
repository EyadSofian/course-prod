"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createLesson, type ActionState } from "../../actions";
import { actions } from "@/lib/strings";

const ACCEPT = ".pdf,.docx,.pptx,.md,.txt";
const MAX_MB = 50;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "جارٍ الرفع…" : actions.upload}
    </button>
  );
}

export function NewLessonForm({
  courses,
}: {
  courses: { id: string; titleAr: string; code: string; market: string }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createLesson, {});
  const [fileNote, setFileNote] = useState<string | null>(null);

  return (
    <form action={formAction}>
      {state.error ? (
        <div className="alert alert-error" style={{ marginBlockEnd: 16 }} role="alert">
          {state.error}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="titleAr">عنوان الدرس</label>
        <input id="titleAr" name="titleAr" required maxLength={200} />
      </div>

      <div className="field">
        <label htmlFor="courseId">الكورس</label>
        <select id="courseId" name="courseId" required className="select">
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.titleAr} ({c.code} · {c.market})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="file">المادة العلمية</label>
        <input
          id="file"
          name="file"
          type="file"
          accept={ACCEPT}
          required
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return setFileNote(null);
            const mb = file.size / 1024 / 1024;
            setFileNote(
              mb > MAX_MB
                ? `الملف ${mb.toFixed(0)} MB والحد ${MAX_MB} MB. اضغط الملف أو قسّم المادة.`
                : `${file.name} — ${mb.toFixed(1)} MB`,
            );
          }}
        />
        <span className="muted">المدعوم: PDF، DOCX، PPTX، MD، TXT — حتى {MAX_MB} MB.</span>
        {fileNote ? <span className="muted">{fileNote}</span> : null}
      </div>

      <Submit />
    </form>
  );
}
