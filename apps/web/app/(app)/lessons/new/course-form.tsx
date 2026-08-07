"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createCourse, type ActionState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-secondary" style={{ inlineSize: "100%" }} disabled={pending}>
      {pending ? "جارٍ الحفظ…" : "إضافة الكورس"}
    </button>
  );
}

export function CourseForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createCourse, {});

  return (
    <form action={formAction}>
      {state.error ? (
        <div className="alert alert-error" style={{ marginBlockEnd: 12 }} role="alert">
          {state.error}
        </div>
      ) : null}
      {state.ok ? (
        <div className="alert alert-ok" style={{ marginBlockEnd: 12 }} role="status">
          {state.ok}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="c-title">العنوان</label>
        <input id="c-title" name="titleAr" required maxLength={200} />
      </div>

      <div className="field">
        <label htmlFor="c-code">الكود</label>
        <input id="c-code" name="code" required maxLength={40} placeholder="PMP-2026" dir="ltr" />
      </div>

      <div className="field">
        <label htmlFor="c-market">السوق</label>
        <select id="c-market" name="targetMarket" className="select" defaultValue="EG">
          <option value="EG">مصر</option>
          <option value="KSA">السعودية</option>
          <option value="GULF">الخليج</option>
        </select>
      </div>

      <Submit />
    </form>
  );
}
