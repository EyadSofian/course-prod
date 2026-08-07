/**
 * Structured JSON logs, one object per line, with lesson_id + stage on every
 * line that has them (§9).
 *
 * Redaction is by key name and is not optional: §10 forbids logging a token, a
 * cookie, or storageState. Anything whose key looks secret is replaced before
 * serialisation, however deep in the object it sits.
 */

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|authorization|cookie|session|storagestate|bearer|credential)/i;

const REDACTED = "[redacted]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  lesson_id?: string;
  stage?: string;
  attempt?: number;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  /** Returns a logger that stamps `ctx` onto every subsequent line. */
  child(ctx: LogContext): Logger;
}

function emit(service: string, base: LogContext, level: LogLevel, msg: string, ctx?: LogContext) {
  const line = {
    ts: new Date().toISOString(),
    level,
    service,
    msg,
    ...(redact({ ...base, ...ctx }) as Record<string, unknown>),
  };
  const serialised = JSON.stringify(line);
  if (level === "error") process.stderr.write(serialised + "\n");
  else process.stdout.write(serialised + "\n");
}

export function createLogger(service: string, base: LogContext = {}): Logger {
  return {
    debug: (m, c) => emit(service, base, "debug", m, c),
    info: (m, c) => emit(service, base, "info", m, c),
    warn: (m, c) => emit(service, base, "warn", m, c),
    error: (m, c) => emit(service, base, "error", m, c),
    child: (ctx) => createLogger(service, { ...base, ...ctx }),
  };
}
