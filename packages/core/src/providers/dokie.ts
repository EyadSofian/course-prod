import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger } from "../logger.js";
import type { LessonJson } from "../schema/lesson.js";
import { RetryableError, TerminalError } from "../stages.js";

const log = createLogger("dokie");

/**
 * Dokie MCP deck generation (§6.4).
 *
 * Only three tools exist: create_ppt, reply_ppt, get_ppt_status. Nothing here
 * retries a generation automatically — credits are real money (§13). A failed
 * generation surfaces to a human who decides whether to spend again.
 */

export const DOKIE_MCP_URL = "https://mcp.dokie.ai/mcp";

export const DOKIE_TOOLS = {
  create: "create_ppt",
  reply: "reply_ppt",
  status: "get_ppt_status",
} as const;

/** §6.4 polling schedule: 5s → 15s → 30s, capped at 15 minutes total. */
export const POLL_SCHEDULE_MS = [5_000, 15_000, 30_000] as const;
export const POLL_CAP_MS = 15 * 60 * 1000;

export interface DokieSession {
  client: Client;
  close(): Promise<void>;
}

export async function connect(): Promise<DokieSession> {
  const apiKey = process.env.DOKIE_API_KEY;
  if (!apiKey) {
    throw new TerminalError(
      "مفتاح Dokie غير مضبوط. أضف DOKIE_API_KEY إلى إعدادات الخدمة.",
      "AUTH_FAILURE",
    );
  }

  const transport = new StreamableHTTPClientTransport(new URL(DOKIE_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });

  const client = new Client(
    { name: "course-prod", version: "0.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
  } catch (e) {
    throw classifyDokieError(e, "تعذّر الاتصال بخدمة Dokie");
  }

  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

/**
 * Deck brief built from slides[] (§6.4): title + bullets + visual_cue +
 * layout hint. Narration and quiz are deliberately excluded — Dokie renders
 * slides, and sending the script would both waste tokens and risk it being
 * printed onto them.
 */
export function buildDeckBrief(lesson: LessonJson): string {
  const lines: string[] = [
    `العنوان: ${lesson.title_ar}`,
    `اللغة: العربية (اتجاه من اليمين إلى اليسار)`,
    `عدد الشرائح المطلوب: ${lesson.slides.length}`,
    "",
    "الشرائح:",
  ];

  for (const [i, slide] of lesson.slides.entries()) {
    lines.push(`${i + 1}. [${slide.layout}] ${slide.title_ar}`);
    for (const bullet of slide.bullets) lines.push(`   - ${bullet}`);
    if (slide.visual_cue.trim()) lines.push(`   (اقتراح بصري: ${slide.visual_cue})`);
    lines.push("");
  }

  lines.push(
    "التزم بعدد الشرائح وترتيبها ونصوصها كما هي دون إضافة أو حذف أو إعادة صياغة.",
  );
  return lines.join("\n");
}

/** Text content flattened out of an MCP tool result, for defensive parsing. */
function resultText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : JSON.stringify(result);
  return content
    .map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Dokie's exact payload shape is not documented, so every field is pulled out
 * defensively and the raw text is always returned for stage_runs.log. A schema
 * change should surface as "we could not find the project URL" with the raw
 * response attached, not as a crash.
 */
function extractProjectUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>)\]]+/g);
  if (!match) return null;
  return match.find((u) => /dokie\.ai/i.test(u)) ?? match[0] ?? null;
}

function extractProjectId(text: string): string | null {
  const json = tryJson(text);
  if (json) {
    for (const key of ["project_id", "projectId", "id", "ppt_id", "pptId"]) {
      const v = (json as Record<string, unknown>)[key];
      if (typeof v === "string" && v) return v;
    }
  }
  const url = extractProjectUrl(text);
  const fromUrl = url?.match(/\/([A-Za-z0-9_-]{6,})\/?$/)?.[1];
  return fromUrl ?? null;
}

function tryJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

export type DeckStatus = "pending" | "needs_reply" | "ready" | "failed";

export interface StatusResult {
  status: DeckStatus;
  projectUrl: string | null;
  projectId: string | null;
  /** Set when Dokie is asking the producer to confirm an outline (§6.4). */
  question: string | null;
  raw: string;
}

function classifyStatus(text: string): DeckStatus {
  const lower = text.toLowerCase();
  if (/\b(failed|error|cancell?ed)\b/.test(lower)) return "failed";
  if (/\b(completed|complete|ready|success|done|finished)\b/.test(lower)) return "ready";
  if (/\b(confirm|approve|question|awaiting|outline|reply)\b/.test(lower)) return "needs_reply";
  return "pending";
}

export async function createPpt(
  session: DokieSession,
  topic: string,
  brief: string,
): Promise<StatusResult> {
  // create_ppt rejects a call missing `topic` outright (schema-validated
  // before the tool runs, so this costs nothing) — `prompt`/`content` alone
  // are not enough. Dokie's schema is otherwise undocumented; this is the
  // one required field the server has actually told us about.
  const raw = await callTool(session, DOKIE_TOOLS.create, { topic, prompt: brief, content: brief });
  const status = classifyStatus(raw);
  return {
    status: status === "pending" ? "pending" : status,
    projectUrl: extractProjectUrl(raw),
    projectId: extractProjectId(raw),
    question: status === "needs_reply" ? raw : null,
    raw,
  };
}

export async function replyPpt(
  session: DokieSession,
  projectId: string,
  answer: string,
): Promise<StatusResult> {
  const raw = await callTool(session, DOKIE_TOOLS.reply, {
    project_id: projectId,
    projectId,
    message: answer,
    reply: answer,
  });
  const status = classifyStatus(raw);
  return {
    status,
    projectUrl: extractProjectUrl(raw),
    projectId: extractProjectId(raw) ?? projectId,
    question: status === "needs_reply" ? raw : null,
    raw,
  };
}

export async function getStatus(
  session: DokieSession,
  projectId: string,
): Promise<StatusResult> {
  const raw = await callTool(session, DOKIE_TOOLS.status, {
    project_id: projectId,
    projectId,
  });
  const status = classifyStatus(raw);
  return {
    status,
    projectUrl: extractProjectUrl(raw),
    projectId,
    question: status === "needs_reply" ? raw : null,
    raw,
  };
}

async function callTool(
  session: DokieSession,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const result = await session.client.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new TerminalError(
        `رفضت Dokie الطلب (${name}): ${resultText(result).slice(0, 500)}`,
        "SELECTOR_NOT_FOUND",
      );
    }
    return resultText(result);
  } catch (e) {
    if (e instanceof TerminalError) throw e;
    throw classifyDokieError(e, `فشل استدعاء ${name} في Dokie`);
  }
}

/**
 * Polls until ready, needs_reply, failed, or the 15-minute cap (§6.4).
 *
 * Returns rather than throws on needs_reply: an outline question is a request
 * for a human decision surfaced in the UI, not a stage failure.
 */
export async function pollUntilDone(
  session: DokieSession,
  projectId: string,
  opts: { capMs?: number; onPoll?: (n: number, status: StatusResult) => void } = {},
): Promise<StatusResult> {
  const capMs = opts.capMs ?? POLL_CAP_MS;
  const startedAt = Date.now();
  let poll = 0;
  let last: StatusResult | null = null;

  while (Date.now() - startedAt < capMs) {
    const delay = POLL_SCHEDULE_MS[Math.min(poll, POLL_SCHEDULE_MS.length - 1)]!;
    await sleep(delay);
    poll++;

    last = await getStatus(session, projectId);
    opts.onPoll?.(poll, last);
    log.info("dokie poll", { poll, status: last.status, elapsed_s: Math.round((Date.now() - startedAt) / 1000) });

    if (last.status === "ready" && last.projectUrl) return last;
    if (last.status === "needs_reply") return last;
    if (last.status === "failed") {
      throw new TerminalError(
        `فشل توليد العرض في Dokie: ${last.raw.slice(0, 500)}`,
        "SELECTOR_NOT_FOUND",
        { raw: last.raw },
      );
    }
  }

  // The cap is not a fault to retry against — a re-run costs credits again.
  throw new TerminalError(
    `لم يكتمل توليد العرض خلال ${Math.round(capMs / 60_000)} دقيقة. ` +
      `افتح المشروع في Dokie وتحقّق من حالته قبل إعادة التوليد.`,
    "SELECTOR_NOT_FOUND",
    { lastStatus: last?.raw?.slice(0, 2_000) },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyDokieError(e: unknown, prefix: string): Error {
  const message = (e as { message?: string })?.message ?? String(e);
  if (/401|403|unauthor|forbidden/i.test(message)) {
    return new TerminalError(`${prefix}: المصادقة مرفوضة. تحقّق من DOKIE_API_KEY.`, "AUTH_FAILURE");
  }
  if (/429|rate/i.test(message)) return new RetryableError(`${prefix}: الخدمة مزدحمة.`, 30_000);
  if (/5\d\d|timeout|ECONN|ENOTFOUND/i.test(message)) return new RetryableError(`${prefix}: ${message}`);
  return new RetryableError(`${prefix}: ${message}`);
}
