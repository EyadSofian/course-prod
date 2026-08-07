"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Settings } from "@course-prod/core/settings";
import type { ProviderStatus, Voice } from "@/lib/worker";
import { updateSettings, type ActionState } from "../actions";
import { VoicePicker } from "./voice-picker";
import { ProviderKeys } from "./provider-keys";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
      {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
    </button>
  );
}

export function SettingsForm({
  settings,
  baseTemplate,
  readOnly,
  voices,
  voicesError,
  providers,
}: {
  settings: Settings;
  baseTemplate: string;
  readOnly: boolean;
  voices: Voice[];
  voicesError?: string;
  providers: ProviderStatus;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateSettings, {});
  const [prompt, setPrompt] = useState(settings.summarizePromptOverride);

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

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
          <section className="card">
            <h2 style={{ marginBlockEnd: 12 }}>الهيكلة</h2>

            <div className="field">
              <label htmlFor="summarizeProvider">المزوّد</label>
              <select
                id="summarizeProvider"
                name="summarizeProvider"
                className="select"
                defaultValue={settings.summarizeProvider}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="summarizeModel">النموذج الافتراضي</label>
              <input id="summarizeModel" name="summarizeModel" defaultValue={settings.summarizeModel} dir="ltr" />
            </div>

            <div className="field">
              <label htmlFor="summarizeModelDense">نموذج المواد الكثيفة</label>
              <input
                id="summarizeModelDense"
                name="summarizeModelDense"
                defaultValue={settings.summarizeModelDense}
                dir="ltr"
              />
              <span className="muted">
                يُستخدم تلقائياً فوق {settings.denseCharThreshold.toLocaleString("en-US")} حرف.
              </span>
            </div>

            <div className="field">
              <label htmlFor="denseCharThreshold">حد المادة الكثيفة (حرف)</label>
              <input
                id="denseCharThreshold"
                name="denseCharThreshold"
                type="number"
                defaultValue={settings.denseCharThreshold}
                dir="ltr"
              />
            </div>

            <div className="field">
              <label htmlFor="summarizeMaxTokens">الحد الأقصى للرموز</label>
              <input
                id="summarizeMaxTokens"
                name="summarizeMaxTokens"
                type="number"
                defaultValue={settings.summarizeMaxTokens}
                dir="ltr"
              />
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginBlockEnd: 12 }}>الدرس والعرض</h2>

            <div className="field">
              <label htmlFor="slideCap">الحد الأقصى للشرائح</label>
              <input id="slideCap" name="slideCap" type="number" defaultValue={settings.slideCap} dir="ltr" />
              <span className="muted">الرفع يزيد استهلاك رصيد Dokie لكل عرض.</span>
            </div>

            <div className="field">
              <label htmlFor="quizCount">عدد الأسئلة</label>
              <input id="quizCount" name="quizCount" type="number" defaultValue={settings.quizCount} dir="ltr" />
            </div>

            <div className="field">
              <label htmlFor="durationTargetMin">المدة المستهدفة (دقيقة)</label>
              <input
                id="durationTargetMin"
                name="durationTargetMin"
                type="number"
                defaultValue={settings.durationTargetMin}
                dir="ltr"
              />
            </div>

            <div className="field">
              <label htmlFor="dokieCreditCentsPerSlide">تقدير تكلفة الشريحة (سنت)</label>
              <input
                id="dokieCreditCentsPerSlide"
                name="dokieCreditCentsPerSlide"
                type="number"
                defaultValue={settings.dokieCreditCentsPerSlide}
                dir="ltr"
              />
              <span className="muted">تقديري — Dokie لا يوفّر التكلفة الفعلية عبر الـ API.</span>
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginBlockEnd: 12 }}>الصوت</h2>

            <div className="field">
              <label htmlFor="ttsModel">نموذج الصوت</label>
              <select id="ttsModel" name="ttsModel" className="select" defaultValue={settings.ttsModel}>
                <option value="eleven_v3">eleven_v3 (حد 3,000 حرف/طلب)</option>
                <option value="eleven_multilingual_v2">eleven_multilingual_v2 (حد 10,000)</option>
                <option value="eleven_flash_v2_5">eleven_flash_v2_5 (أرخص)</option>
              </select>
            </div>

            <VoicePicker voices={voices} current={settings.voiceId} error={voicesError} />
          </section>

          <section className="card">
            <h2 style={{ marginBlockEnd: 12 }}>الميزانية</h2>

            <div className="field">
              <label htmlFor="monthlyBudgetUsd">السقف الشهري (دولار)</label>
              <input
                id="monthlyBudgetUsd"
                name="monthlyBudgetUsd"
                type="number"
                step="1"
                defaultValue={settings.monthlyBudgetUsd}
                dir="ltr"
              />
              <span className="muted">
                عند بلوغ السقف تتوقف المراحل المكلفة ويُرسل تنبيه على Telegram.
              </span>
            </div>

            <div className="field">
              <label htmlFor="budgetWarnPercent">نسبة التحذير (%)</label>
              <input
                id="budgetWarnPercent"
                name="budgetWarnPercent"
                type="number"
                defaultValue={settings.budgetWarnPercent}
                dir="ltr"
              />
            </div>
          </section>
        </div>

        <div style={{ marginBlockStart: 16 }}>
          <ProviderKeys providers={providers} />
        </div>

        <section className="card" style={{ marginBlockStart: 16 }}>
          <h2 style={{ marginBlockEnd: 8 }}>قالب الهيكلة</h2>
          <p className="muted" style={{ marginBlockStart: 0 }}>
            يتجاوز القالب الأساسي في <span className="mono">packages/core/prompts/summarize.ar.md</span>.
            اتركه فارغاً لاستخدام القالب الأساسي.
          </p>

          <textarea
            name="summarizePromptOverride"
            rows={14}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{ inlineSize: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />

          <div style={{ display: "flex", gap: 8, marginBlockStart: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPrompt("")}>
              استعادة القالب الأساسي
            </button>
            {baseTemplate ? (
              <button type="button" className="btn btn-ghost" onClick={() => setPrompt(baseTemplate)}>
                نسخ القالب الأساسي للتعديل
              </button>
            ) : null}
          </div>
        </section>

        <div style={{ marginBlockStart: 16 }}>
          <Submit disabled={readOnly} />
        </div>
      </fieldset>
    </form>
  );
}
