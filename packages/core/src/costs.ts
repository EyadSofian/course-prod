import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./db/client.js";
import { lessons, stageRuns } from "./db/schema.js";
import { formatUsd, type Settings } from "./settings.js";
import { TerminalError, type Stage } from "./stages.js";

/**
 * Cost tracking and budget ceilings (§7).
 *
 * The point is not accounting, it is refusal: a stage that would cross the
 * ceiling enters BLOCKED_BUDGET and pings Telegram instead of running.
 */

export interface MonthlySpend {
  totalCents: number;
  byProvider: { llm: number; tts: number; dokie: number };
  monthStart: Date;
}

/** Which provider each stage spends with, for the §7 breakdown. */
const STAGE_PROVIDER: Partial<Record<Stage, keyof MonthlySpend["byProvider"]>> = {
  SUMMARIZE: "llm",
  DECK: "dokie",
  NARRATE: "tts",
};

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthlySpend(now = new Date()): Promise<MonthlySpend> {
  const db = getDb();
  const start = monthStart(now);

  // Summed from stage_runs, not lessons.cost_cents: a lesson's total is a
  // rolling figure that regeneration overwrites, whereas every attempt leaves
  // a stage_run behind. Money spent on a failed attempt was still spent.
  const rows = await db
    .select({
      stage: stageRuns.stage,
      total: sql<number>`coalesce(sum(${stageRuns.costCents}), 0)::int`,
    })
    .from(stageRuns)
    .where(gte(stageRuns.startedAt, start))
    .groupBy(stageRuns.stage);

  const byProvider = { llm: 0, tts: 0, dokie: 0 };
  let totalCents = 0;
  for (const row of rows) {
    totalCents += row.total;
    const provider = STAGE_PROVIDER[row.stage as Stage];
    if (provider) byProvider[provider] += row.total;
  }

  return { totalCents, byProvider, monthStart: start };
}

export interface BudgetCheck {
  allowed: boolean;
  spentCents: number;
  capCents: number;
  projectedCents: number;
  /** Producer-facing text, already formatted (§4.3 of the copy deck). */
  message?: string;
}

/**
 * Called before any billable stage. `estimateCents` is what this run is
 * expected to add — a check against current spend alone would let a single
 * expensive generation sail past the ceiling.
 */
export async function checkBudget(
  estimateCents: number,
  settings: Settings,
  now = new Date(),
): Promise<BudgetCheck> {
  const spend = await monthlySpend(now);
  const capCents = Math.round(settings.monthlyBudgetUsd * 100);
  const projectedCents = spend.totalCents + estimateCents;

  if (projectedCents > capCents) {
    return {
      allowed: false,
      spentCents: spend.totalCents,
      capCents,
      projectedCents,
      message:
        `تشغيل هذه المرحلة سيرفع مصروف الشهر إلى ${formatUsd(projectedCents)}، ` +
        `والسقف ${formatUsd(capCents)}. ارفع السقف من الإعدادات، أو انتظر بداية الشهر القادم.`,
    };
  }

  return { allowed: true, spentCents: spend.totalCents, capCents, projectedCents };
}

export async function assertBudget(
  estimateCents: number,
  settings: Settings,
  now = new Date(),
): Promise<void> {
  const check = await checkBudget(estimateCents, settings, now);
  if (!check.allowed) {
    throw new TerminalError(check.message!, "BUDGET_BLOCKED", {
      spentCents: check.spentCents,
      capCents: check.capCents,
      projectedCents: check.projectedCents,
    });
  }
}

/** Warning threshold for the dashboard (§7 / copy deck §4.5). */
export function budgetWarning(spend: MonthlySpend, settings: Settings): string | null {
  const capCents = Math.round(settings.monthlyBudgetUsd * 100);
  if (capCents <= 0) return null;
  const percent = Math.round((spend.totalCents / capCents) * 100);
  if (percent < settings.budgetWarnPercent) return null;
  return (
    `اقتربت من سقف الميزانية — ${formatUsd(spend.totalCents)} من ${formatUsd(capCents)} ` +
    `(${percent}%). المراحل المكلفة ستتوقف عند السقف.`
  );
}

/** Dokie bills in credits, not dollars; §6.4 wants an estimate logged per run. */
export function estimateDeckCents(slideCount: number, settings: Settings): number {
  return Math.round(slideCount * settings.dokieCreditCentsPerSlide);
}

export async function addLessonCost(lessonId: string, cents: number): Promise<void> {
  if (cents === 0) return;
  const db = getDb();
  await db
    .update(lessons)
    .set({ costCents: sql`${lessons.costCents} + ${cents}`, updatedAt: new Date() })
    .where(eq(lessons.id, lessonId));
}

export async function lessonCostBreakdown(
  lessonId: string,
): Promise<{ stage: Stage; costCents: number }[]> {
  const db = getDb();
  const rows = await db
    .select({
      stage: stageRuns.stage,
      total: sql<number>`coalesce(sum(${stageRuns.costCents}), 0)::int`,
    })
    .from(stageRuns)
    .where(and(eq(stageRuns.lessonId, lessonId)))
    .groupBy(stageRuns.stage);
  return rows.map((r) => ({ stage: r.stage as Stage, costCents: r.total }));
}
