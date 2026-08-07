import { z } from "zod";

/**
 * All secrets come from the environment (§10). Nothing here is ever logged —
 * see logger.ts, which redacts by key name.
 *
 * Split into three schemas so the small web image does not fail to boot just
 * because a worker-only credential is missing.
 */

const shared = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  SERVICE_KEY: z.string().min(32, "SERVICE_KEY must be at least 32 chars"),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  STATE_DIR: z.string().default("/data"),
  MONTHLY_BUDGET_USD: z.coerce.number().positive().default(300),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
};

const webSchema = z.object({
  ...shared,
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),
  PORT: z.coerce.number().default(3000),
});

const workerSchema = z.object({
  ...shared,
  PORT: z.coerce.number().default(3001),
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-").optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  DOKIE_API_KEY: z.string().optional(),
  DOKIE_EMAIL: z.string().email().optional(),
  DOKIE_PASSWORD: z.string().optional(),
});

export type WebEnv = z.infer<typeof webSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Print the failing keys only. Never print values — a malformed secret is
    // still a secret.
    const keys = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid ${label} environment:\n  ${keys.join("\n  ")}`);
  }
  return result.data;
}

let webEnv: WebEnv | undefined;
let workerEnv: WorkerEnv | undefined;

export function getWebEnv(): WebEnv {
  webEnv ??= parse(webSchema, "web");
  return webEnv;
}

export function getWorkerEnv(): WorkerEnv {
  workerEnv ??= parse(workerSchema, "worker");
  return workerEnv;
}
