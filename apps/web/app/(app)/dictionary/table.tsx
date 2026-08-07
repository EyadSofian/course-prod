"use client";

import { useActionState, useMemo, useState } from "react";
import { applyPronunciations, countTashkeel } from "@course-prod/core/pronunciation";
import { deleteTerm, saveTerm, type ActionState } from "../actions";

interface Entry {
  id: string;
  term: string;
  replacement: string;
  note: string | null;
  scope: string;
  courseId: string | null;
}

const SAMPLE_DEFAULT =
  "شهادة PMP من انجوسوفت تعتمد على PMBOK وتغطي منهجية Agile في إدارة المشاريع.";

/**
 * §6.6 — the dictionary with a live before/after preview and the character
 * delta, so the cost of each addition is visible before it is saved.
 */
export function DictionaryTable({
  entries,
  courses,
  usdPer1kChars,
}: {
  entries: Entry[];
  courses: { id: string; titleAr: string; code: string }[];
  usdPer1kChars: number;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveTerm, {});
  const [editing, setEditing] = useState<Entry | null>(null);
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [sample, setSample] = useState(SAMPLE_DEFAULT);

  const preview = useMemo(() => {
    if (!term.trim()) return null;
    const result = applyPronunciations(sample, [{ term, replacement: replacement || term }]);
    const hit = result.applied[0];
    return {
      after: result.text,
      occurrences: hit?.count ?? 0,
      charDelta: result.charDelta,
      usdPerRun: (result.charDelta / 1000) * usdPer1kChars,
      tashkeel: countTashkeel(replacement),
    };
  }, [term, replacement, sample, usdPer1kChars]);

  const startEdit = (entry: Entry) => {
    setEditing(entry);
    setTerm(entry.term);
    setReplacement(entry.replacement);
  };

  const reset = () => {
    setEditing(null);
    setTerm("");
    setReplacement("");
  };

  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0,1fr) 360px" }}>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>المصطلح</th>
              <th>البديل</th>
              <th>النطاق</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 20 }}>
                  لا توجد مصطلحات بعد.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.term}</td>
                  <td>
                    {e.replacement}
                    {countTashkeel(e.replacement) > 0 ? (
                      <span className="chip" style={{ marginInlineStart: 6 }}>
                        تشكيل
                      </span>
                    ) : null}
                  </td>
                  <td className="muted">
                    {e.scope === "global"
                      ? "عام"
                      : (courses.find((c) => c.id === e.courseId)?.code ?? "كورس")}
                  </td>
                  <td style={{ textAlign: "end", whiteSpace: "nowrap" }}>
                    <button type="button" className="btn btn-ghost" onClick={() => startEdit(e)}>
                      تعديل
                    </button>
                    <form action={deleteTerm} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" className="btn btn-ghost">
                        حذف
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginBlockEnd: 12 }}>{editing ? "تعديل مصطلح" : "إضافة مصطلح"}</h2>

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

        <form action={formAction}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />

          <div className="field">
            <label htmlFor="term">المصطلح</label>
            <input id="term" name="term" value={term} onChange={(e) => setTerm(e.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="replacement">البديل</label>
            <input
              id="replacement"
              name="replacement"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              required
            />
            <span className="muted">اتركه مطابقاً للمصطلح إن أردت التشكيل فقط.</span>
          </div>

          <div className="field">
            <label htmlFor="note">ملاحظة</label>
            <input id="note" name="note" defaultValue={editing?.note ?? ""} />
          </div>

          <div className="field">
            <label htmlFor="courseId">النطاق</label>
            <select id="courseId" name="courseId" className="select" defaultValue={editing?.courseId ?? ""}>
              <option value="">عام (كل الكورسات)</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titleAr} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary">
              حفظ
            </button>
            {editing ? (
              <button type="button" className="btn btn-secondary" onClick={reset}>
                إلغاء
              </button>
            ) : null}
          </div>
        </form>

        <hr style={{ margin: "16px 0", border: 0, borderBlockStart: "1px solid var(--border)" }} />

        <h3 style={{ marginBlockEnd: 8 }}>معاينة</h3>
        <div className="field">
          <label htmlFor="sample">نص تجريبي</label>
          <textarea id="sample" rows={3} value={sample} onChange={(e) => setSample(e.target.value)} />
        </div>

        {preview ? (
          <>
            <div className="preview-row">
              <span className="preview-label">قبل</span>
              <div>{sample}</div>
            </div>
            <div className="preview-row">
              <span className="preview-label">بعد</span>
              <div>{preview.after}</div>
            </div>

            {preview.occurrences === 0 ? (
              <p className="muted" style={{ marginBlockEnd: 0 }}>
                لم يظهر المصطلح في النص التجريبي. الاستبدال يطبَّق على الكلمات الكاملة فقط.
              </p>
            ) : (
              <p className="muted" style={{ marginBlockEnd: 0 }}>
                {preview.occurrences} ورود ·{" "}
                <span className="num">
                  {preview.charDelta >= 0 ? "+" : ""}
                  {preview.charDelta}
                </span>{" "}
                حرف لكل تشغيل ≈{" "}
                <span className="num">${Math.abs(preview.usdPerRun).toFixed(4)}</span>
                {preview.tashkeel > 0 ? (
                  <>
                    <br />
                    التشكيل يضيف {preview.tashkeel} حرفاً مفوتراً لكل ورود.
                  </>
                ) : null}
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ marginBlockEnd: 0 }}>
            اكتب مصطلحاً لرؤية المعاينة.
          </p>
        )}
      </div>
    </div>
  );
}
