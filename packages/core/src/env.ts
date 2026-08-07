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
  /**
   * Private address of the worker. Required because the Railway volume mounts
   * to exactly one service: web cannot read or write /data, so uploads and
   * downloads are proxied through the worker's SERVICE_KEY-protected surface.
   */
  WORKER_URL: z.string().url().default("http://course-prodworker.railway.internal:3001"),
});

const workerSchema = z.object({
  ...shared,
  PORT: z.coerce.number().default(3001),
  // Summarization provider (§6.2). Both are optional so the worker boots for
  // stages that do not need them — a missing key fails its own stage with a
  // clear terminal error rather than preventing the service from starting.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  DOKIE_API_KEY: z.string().optional(),
  DOKIE_EMAIL: z.string().email().optional(),
  DOKIE_PASSWORD: z.string().optional(),
});

export type WebEnv = z.infer<typeof webSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

/** Variables that must be generated rather than invented. */
const GENERATED_SECRETS = new Set(["SERVICE_KEY", "SESSION_SECRET"]);

function parse<T extends z.ZodTypeAny>(schema: T, label: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Failing keys and messages only — never values. A malformed secret is
    // still a secret, and this text goes straight into the deploy log.
    const keys = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

    // A bare "must be at least 32 chars" leaves the reader to guess how to
    // produce one, and the usual guess is to type something longer by hand.
    const needsSecret = result.error.issues.some((i) =>
      GENERATED_SECRETS.has(String(i.path[0])),
    );
    const hint = needsSecret
      ? "\n\nGenerate each one separately (44 chars, well over the minimum):\n" +
        "  openssl rand -base64 32\n" +
        "SERVICE_KEY and SESSION_SECRET must differ from each other, and each " +
        "must be identical on the web and worker services."
      : "";

    throw new Error(`Invalid ${label} environment:\n  ${keys.join("\n  ")}${hint}`);
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
