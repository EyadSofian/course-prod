"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { answerDokie } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "جارٍ الإرسال…" : "تأكيد وبدء التوليد"}
    </button>
  );
}

/**
 * §6.4 — Dokie asked for outline confirmation.
 *
 * Styled as an attention state, not an error: this is a question awaiting a
 * decision, and nothing has failed. The copy makes the cost explicit because
 * confirming is what starts spending credits.
 */
export function DokieQuestion({ lessonId, question }: { lessonId: string; question: string }) {
  const [answer, setAnswer] = useState("موافق، تابع التوليد بنفس المخطط.");

  return (
    <section className="card" style={{ borderColor: "#FED7AA", background: "#FFF7ED", marginBlockEnd: 16 }}>
      <h2 style={{ marginBlockEnd: 6 }}>Dokie يطلب تأكيد المخطط قبل توليد العرض</h2>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        راجع المخطط أدناه. التأكيد يبدأ التوليد ويستهلك الرصيد.
      </p>

      <pre className="stage-log" style={{ maxBlockSize: 240 }}>
        {question}
      </pre>

      <form action={answerDokie} style={{ marginBlockStart: 12 }}>
        <input type="hidden" name="lessonId" value={lessonId} />
        <div className="field">
          <label htmlFor="dokie-answer">الرد</label>
          <textarea
            id="dokie-answer"
            name="answer"
            rows={3}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
          />
        </div>
        <Submit />
      </form>
    </section>
  );
}
