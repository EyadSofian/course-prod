"use client";

import type { ProviderStatus } from "@/lib/worker";

/**
 * Which provider keys are configured, and where to set them.
 *
 * §10 requires all secrets to come from the environment, so these are not
 * editable here — but a producer opening Settings and finding no field for
 * "the OpenAI key" has no way to tell whether it is missing or simply
 * elsewhere. This answers that: status per provider, and the exact variable
 * name and service to set it on.
 */

interface Row {
  key: keyof ProviderStatus | string;
  label: string;
  variable: string;
  service: string;
  need: string;
}

const ROWS: Row[] = [
  {
    key: "openai",
    label: "OpenAI — هيكلة الدرس",
    variable: "OPENAI_API_KEY",
    service: "worker",
    need: "مطلوب لتحويل المادة إلى درس مُهيكل",
  },
  {
    key: "elevenlabs",
    label: "ElevenLabs — السرد",
    variable: "ELEVENLABS_API_KEY",
    service: "worker",
    need: "مطلوب لتوليد الصوت، ولعرض قائمة الأصوات في الأعلى",
  },
  {
    key: "dokie",
    label: "Dokie — توليد العرض",
    variable: "DOKIE_API_KEY",
    service: "worker",
    need: "مطلوب لتوليد العرض التقديمي",
  },
  {
    key: "dokieLogin",
    label: "Dokie — تسجيل الدخول",
    variable: "DOKIE_EMAIL + DOKIE_PASSWORD",
    service: "worker",
    need: "مطلوب لتصدير الملفات عبر المتصفح فقط",
  },
  {
    key: "telegram",
    label: "Telegram — التنبيهات",
    variable: "TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID",
    service: "worker",
    need: "اختياري — تنبيهات الفشل وتجاوز الميزانية",
  },
];

export function ProviderKeys({ providers }: { providers: ProviderStatus }) {
  const known = Object.keys(providers).length > 0;

  return (
    <section className="card">
      <h2 style={{ marginBlockEnd: 6 }}>مفاتيح المزوّدين</h2>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        المفاتيح تُضبط كمتغيّرات بيئة على الخدمة، لا من هنا — حتى لا تُخزَّن في قاعدة
        البيانات أو تظهر في سجلّ. هذه الصفحة تعرض أيها مضبوط فقط.
      </p>

      {!known ? (
        <div className="alert alert-warn" role="status">
          تعذّر الوصول إلى خدمة المعالجة لقراءة حالة المفاتيح.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>المزوّد</th>
              <th>المتغيّر</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const set = Boolean(providers[row.key as string]);
              return (
                <tr key={row.key as string}>
                  <td>
                    <div>{row.label}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {row.need}
                    </div>
                  </td>
                  <td>
                    <span className="mono">{row.variable}</span>
                    <div className="muted" style={{ fontSize: 11 }}>
                      خدمة {row.service}
                    </div>
                  </td>
                  <td>
                    <span className={set ? "pill pill-ok" : "pill pill-off"}>
                      {set ? "مضبوط" : "غير مضبوط"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ marginBlockEnd: 0, marginBlockStart: 10, fontSize: 12 }}>
        الضبط من لوحة Railway ← الخدمة ← Variables. بعد الإضافة أعد نشر الخدمة.
      </p>
    </section>
  );
}
