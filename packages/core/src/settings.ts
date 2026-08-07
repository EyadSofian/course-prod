import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client.js";
import { settings } from "./db/schema.js";

/**
 * Models, voices, prompts, budgets and caps live here — never as literals in
 * business logic (§13). Anything a producer might want to change without a
 * deploy belongs in this file.
 */

export const settingsSchema = z.object({
  // §6.2 — models are settings, not literals.
  summarizeModel: z.string().default("claude-sonnet-5"),
  summarizeModelDense: z.string().default("claude-opus-5"),
  /** Char count above which the dense model is used automatically. */
  denseCharThreshold: z.number().int().positive().default(40_000),
  summarizeMaxTokens: z.number().int().positive().default(16_000),
  /** UI override for packages/core/prompts/summarize.ar.md. Empty = use the file. */
  summarizePromptOverride: z.string().default(""),

  // §6.4 — credit guard.
  slideCap: z.number().int().positive().max(60).default(18),
  dokieCreditCentsPerSlide: z.number().nonnegative().default(5),

  // §6.6 — voice + TTS.
  voiceId: z.string().default(""),
  ttsModel: z.enum(["eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"]).default("eleven_v3"),
  quizCount: z.number().int().positive().default(10),
  durationTargetMin: z.number().int().positive().default(10),

  // §7 — budgets.
  monthlyBudgetUsd: z.number().positive().default(300),
  budgetWarnPercent: z.number().min(1).max(100).default(80),
});

export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Per-request hard limits from the ElevenLabs API (§6.6). Not user-editable. */
export const TTS_CHAR_LIMITS: Record<Settings["ttsModel"], number> = {
  eleven_v3: 3_000,
  eleven_multilingual_v2: 10_000,
  eleven_flash_v2_5: 10_000,
};

/** USD per 1,000 characters (§6.6). */
export const TTS_USD_PER_1K_CHARS: Record<Settings["ttsModel"], number> = {
  eleven_v3: 0.1,
  eleven_multilingual_v2: 0.1,
  eleven_flash_v2_5: 0.05,
};

const SETTINGS_KEY = "app";

export async function loadSettings(): Promise<Settings> {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  if (!row) return DEFAULT_SETTINGS;

  // Merge over defaults so a setting added in a later deploy does not read as
  // undefined for an existing row.
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(row.value as object) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>, updatedBy?: string): Promise<Settings> {
  const db = getDb();
  const merged = settingsSchema.parse({ ...(await loadSettings()), ...patch });
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: merged, updatedBy })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: merged, updatedBy, updatedAt: new Date() },
    });
  return merged;
}

export const centsPerUsd = 100;
export const usdToCents = (usd: number) => Math.round(usd * centsPerUsd);
export const centsToUsd = (cents: number) => cents / centsPerUsd;
export const formatUsd = (cents: number) => `$${centsToUsd(cents).toFixed(2)}`;
