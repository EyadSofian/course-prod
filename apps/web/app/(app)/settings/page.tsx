import { readFile } from "node:fs/promises";
import { loadSettings } from "@course-prod/core/settings-store";
import { monthlySpend } from "@course-prod/core/costs";
import { formatUsd } from "@course-prod/core/settings";
import { requireSession } from "@/lib/session";
import { SettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const [settings, spend] = await Promise.all([loadSettings(), monthlySpend()]);

  // Shown so an admin editing the override can see what they are overriding.
  let baseTemplate = "";
  try {
    const url = await import("node:module").then((m) =>
      m.createRequire(import.meta.url).resolve("@course-prod/core/package.json"),
    );
    baseTemplate = await readFile(
      url.replace(/package\.json$/, "prompts/summarize.ar.md"),
      "utf8",
    );
  } catch {
    baseTemplate = "";
  }

  return (
    <>
      <div className="page-head">
        <h1>الإعدادات</h1>
        <span className="muted">
          مصروف الشهر: <span className="num">{formatUsd(spend.totalCents)}</span> من{" "}
          <span className="num">{formatUsd(settings.monthlyBudgetUsd * 100)}</span>
        </span>
      </div>

      {session.role !== "admin" ? (
        <div className="alert alert-warn" role="status">
          الإعدادات متاحة للمسؤولين فقط. يمكنك الاطلاع دون التعديل.
        </div>
      ) : null}

      <SettingsForm
        settings={settings}
        baseTemplate={baseTemplate}
        readOnly={session.role !== "admin"}
      />
    </>
  );
}
