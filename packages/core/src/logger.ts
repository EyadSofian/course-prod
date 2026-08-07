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
    // describeError, not .message: an AggregateError's own message is empty
    // and the useful ECONNREFUSED sits in .errors, so a raw .message logs a
    // connection failure as a blank string.
    return { name: value.name, message: describeError(value), stack: value.stack };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

/**
 * Turns an unknown thrown value into something a human can act on.
 *
 * Node's happy-eyeballs connect failures arrive as an AggregateError whose own
 * `.message` is the empty string, with the real cause (ECONNREFUSED and
 * friends) buried in `.errors`. Reading `.message` alone therefore reports a
 * dead database as a blank string — which is exactly the case /health exists
 * to explain.
 */
export function describeError(err: unknown): string {
  if (err == null) return "unknown error";

  if (err instanceof AggregateError) {
    const inner = err.errors.map(describeError).filter(Boolean);
    const unique = [...new Set(inner)];
    if (unique.length) return `${err.message || "AggregateError"}: ${unique.join("; ")}`;
  }

  // Node's fetch reports every network failure as the bare string
  // "fetch failed" and hides the real reason — ENOTFOUND, ECONNREFUSED,
  // a TLS error — on `.cause`. Without unwrapping it, a wrong hostname and a
  // dead port produce identical, useless messages.
  const cause = (err as { cause?: unknown }).cause;
  if (cause != null && cause !== err) {
    const inner = describeError(cause);
    const outer = err instanceof Error ? err.message : "";
    if (inner && inner !== outer) return outer ? `${outer}: ${inner}` : inner;
  }

  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    const parts = [err.message || err.name, code && !err.message?.includes(code) ? `(${code})` : ""];
    const joined = parts.filter(Boolean).join(" ").trim();
    if (joined) return joined;
  }

  if (typeof err === "object") {
    const code = (err as { code?: string }).code;
    if (code) return String(code);
  }

  return String(err);
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

/**
 * Where lines go. Injectable so tests can assert on redaction without
 * monkeypatching process.stdout — which is the same channel `node --test`
 * writes TAP to, and hijacking it corrupts the run.
 */
export type LogSink = (level: LogLevel, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

function emit(
  service: string,
  base: LogContext,
  sink: LogSink,
  level: LogLevel,
  msg: string,
  ctx?: LogContext,
) {
  sink(
    level,
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service,
      msg,
      ...(redact({ ...base, ...ctx }) as Record<string, unknown>),
    }),
  );
}

export function createLogger(
  service: string,
  base: LogContext = {},
  sink: LogSink = defaultSink,
): Logger {
  return {
    debug: (m, c) => emit(service, base, sink, "debug", m, c),
    info: (m, c) => emit(service, base, sink, "info", m, c),
    warn: (m, c) => emit(service, base, sink, "warn", m, c),
    error: (m, c) => emit(service, base, sink, "error", m, c),
    child: (ctx) => createLogger(service, { ...base, ...ctx }, sink),
  };
}
