import { z } from "zod";

/**
 * Models, voices, prompts, budgets and caps live here — never as literals in
 * business logic (§13). Anything a producer might want to change without a
 * deploy belongs in this file.
 *
 * This module is deliberately free of database imports. Client components need
 * formatUsd and the TTS rate tables, and when those sat alongside loadSettings
 * the pg driver followed them into the browser bundle and the build failed on
 * `Can't resolve 'net'`. Reads and writes live in ./settings-store.ts.
 */

export const settingsSchema = z.object({
  // §6.2 — models are settings, not literals. Provider is switchable because
  // the deployment uses OpenAI; the Anthropic path is kept working so moving
  // back is a settings change rather than a code change.
  summarizeProvider: z.enum(["openai", "anthropic"]).default("openai"),
  summarizeModel: z.string().default("gpt-5.6"),
  summarizeModelDense: z.string().default("gpt-5.5-pro"),
  /** Char count above which the dense model is used automatically. */
  denseCharThreshold: z.number().int().positive().default(40_000),
  summarizeMaxTokens: z.number().int().positive().default(16_000),
  /**
   * USD per million tokens, per model. Settings rather than a hardcoded table
   * because provider pricing changes more often than this code will.
   * Unknown models fall back to `llmFallbackRate` and are flagged in the log
   * so a silent $0.00 never masks real spend.
   */
  llmRates: z
    .record(z.object({ inputPerMTok: z.number(), outputPerMTok: z.number() }))
    .default({
      "gpt-5.6": { inputPerMTok: 1.25, outputPerMTok: 10 },
      "gpt-5.5-pro": { inputPerMTok: 15, outputPerMTok: 120 },
    }),
  llmFallbackRate: z
    .object({ inputPerMTok: z.number(), outputPerMTok: z.number() })
    .default({ inputPerMTok: 5, outputPerMTok: 20 }),
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

/**
 * Per-request hard limits, taken from ElevenLabs' own model documentation.
 *
 * §6.6 states 3,000 for eleven_v3 and this code copied that without checking.
 * The published limit is 5,000, and flash is 40,000 rather than the 10,000
 * assumed here. Under-stating a limit is not harmless: every split is a hard
 * concat seam where prosody restarts, so narration was being broken into more
 * pieces than the API ever required and sounding stitched together.
 */
export const TTS_CHAR_LIMITS: Record<Settings["ttsModel"], number> = {
  eleven_v3: 5_000,
  eleven_multilingual_v2: 10_000,
  eleven_flash_v2_5: 40_000,
};

/** USD per 1,000 characters (§6.6). */
export const TTS_USD_PER_1K_CHARS: Record<Settings["ttsModel"], number> = {
  eleven_v3: 0.1,
  eleven_multilingual_v2: 0.1,
  eleven_flash_v2_5: 0.05,
};

export const SETTINGS_KEY = "app";

export const centsPerUsd = 100;
export const usdToCents = (usd: number) => Math.round(usd * centsPerUsd);
export const centsToUsd = (cents: number) => cents / centsPerUsd;
export const formatUsd = (cents: number) => `$${centsToUsd(cents).toFixed(2)}`;
