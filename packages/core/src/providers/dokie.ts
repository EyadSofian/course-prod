import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger } from "../logger.js";
import type { LessonJson } from "../schema/lesson.js";
import { RetryableError, TerminalError } from "../stages.js";

const log = createLogger("dokie");

/**
 * Dokie MCP deck generation (§6.4).
 *
 * Nothing here retries a generation automatically — credits are real money
 * (§13). A failed generation surfaces to a human who decides whether to spend
 * again.
 *
 * Dokie publishes no schema for its MCP surface — everything below is taken
 * from GET /dokie/tools (a live listTools() call), not from docs. Two things
 * this codebase assumed were wrong: `reply_ppt` and `get_ppt_status` are not
 * real tool names (they're `reply_dokie` and `get_project_status`), and
 * create_ppt's real shape is `{ topic, context? }` with
 * `additionalProperties: false` — the detailed slide-by-slide brief was
 * being sent as `content`/`prompt`, fields the tool doesn't declare, and
 * silently dropped rather than rejected. If either drifts again, hit
 * /dokie/tools rather than re-guessing.
 */

export const DOKIE_MCP_URL = "https://mcp.dokie.ai/mcp";

export const DOKIE_TOOLS = {
  create: "create_ppt",
  reply: "reply_dokie",
  status: "get_project_status",
} as const;

/** Dokie's own documented cadence: poll get_project_status every 20s. */
export const POLL_SCHEDULE_MS = [20_000] as const;
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

export interface DokieToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/** Ground truth for Dokie's current MCP surface — see the module comment. */
export async function listDokieTools(session: DokieSession): Promise<DokieToolInfo[]> {
  const { tools } = await session.client.listTools();
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
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

/**
 * One content block from an MCP tool result. Every create_ppt / reply_dokie /
 * get_project_status response carries the same two-audience shape — verbatim
 * from each tool's description in GET /dokie/tools: a text block tagged
 * `assistant` holding an orchestration JSON (projectId, phase, running,
 * completedPages/totalPages, nextAction, agentInstructions), and separate
 * block(s) tagged `user` holding what a human should actually see (keyinfo,
 * outline, preview images, the project link). Dokie is explicit the two must
 * not be conflated — showing the raw orchestration JSON to a person, or
 * substituting its `reply` field for the real `user` block, both lose the
 * formatted checkpoint content it describes as the only complete version.
 */
interface DokieBlock {
  type?: string;
  text?: string;
  annotations?: { audience?: string[] };
}

function blocks(result: unknown): DokieBlock[] {
  const content = (result as { content?: unknown })?.content;
  return Array.isArray(content) ? (content as DokieBlock[]) : [];
}

function textFor(bs: DokieBlock[], audience: "assistant" | "user"): string[] {
  return bs
    .filter((b) => b.type === "text" && typeof b.text === "string" && b.annotations?.audience?.includes(audience))
    .map((b) => b.text as string);
}

function allText(bs: DokieBlock[]): string {
  return bs
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
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

interface DokieOrchestration {
  projectId?: string;
  /** Documented values: init | keyinfo | outline | generated | done. */
  phase?: string;
  running?: boolean;
  completedPages?: number;
  totalPages?: number;
  /** Documented values include get_project_status and wait_for_user. */
  nextAction?: string;
  agentInstructions?: string[];
  confirmationStep?: unknown;
}

/**
 * The user-audience block arrives wrapped in delimiter lines —
 * `=== BEGIN USER MESSAGE (...) === … === END USER MESSAGE ===` — that
 * agentInstructions explicitly says to strip before showing a human the
 * content between them. Falls back to the untouched text if the wrapper
 * isn't there, since its exact wording is Dokie's, not a documented schema.
 */
function stripUserMessageWrapper(text: string): string {
  const match = text.match(/===\s*BEGIN USER MESSAGE[^\n]*===\s*\n?([\s\S]*?)\n?\s*===\s*END USER MESSAGE\s*===/);
  return match ? match[1]!.trim() : text;
}

interface ParsedDokieResult {
  orchestration: DokieOrchestration | null;
  /** What a producer should see — the audience:user block(s), verbatim. */
  userText: string;
  /** Every block, for stage_runs.log and for the "shape didn't match" fallback. */
  raw: string;
}

function parseDokieResult(result: unknown): ParsedDokieResult {
  const bs = blocks(result);
  const assistantText = textFor(bs, "assistant")[0];
  const orchestration = assistantText ? (tryJson(assistantText) as DokieOrchestration | null) : null;

  // agentInstructions (forwarding/translation/URL-preservation rules) is
  // written for an LLM agent to interpret — this worker has no LLM in the
  // deck stage, so it forwards `userText` verbatim rather than pretending to
  // apply them. Logged so a real mismatch (Dokie asking for handling this
  // pipeline doesn't do) is visible instead of silently dropped.
  if (orchestration?.agentInstructions) {
    log.info("dokie agentInstructions received (forwarded verbatim, not executed)", {
      instructions: orchestration.agentInstructions,
    });
  }

  return {
    orchestration,
    userText: textFor(bs, "user").map(stripUserMessageWrapper).join("\n\n"),
    raw: allText(bs),
  };
}

function extractProjectUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>)\]]+/g);
  if (!match) return null;
  return match.find((u) => /dokie\.ai/i.test(u)) ?? match[0] ?? null;
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

function classifyStatus(o: DokieOrchestration | null): DeckStatus {
  // No parseable orchestration block is an unexpected shape, not evidence of
  // failure — treat as still-running so a format drift surfaces as a stall
  // in stage_runs.log rather than a wrongly terminal error.
  if (!o) return "pending";
  if (o.nextAction === "wait_for_user" || o.confirmationStep) return "needs_reply";
  // "failed" is not among the phases the tool description enumerates
  // (init | keyinfo | outline | generated | done) — this is a defensive net
  // for a value it doesn't document, not the primary signal.
  if (/fail|error|cancel/i.test(`${o.phase ?? ""} ${o.nextAction ?? ""}`)) return "failed";
  if (o.phase === "done") return "ready";
  return "pending";
}

function toStatusResult(parsed: ParsedDokieResult, fallbackProjectId?: string): StatusResult {
  const status = classifyStatus(parsed.orchestration);
  // Only fall back to scanning the whole response for a URL once phase=done
  // independently confirms completion. Otherwise an unrelated URL sitting in
  // the orchestration JSON (a debug or preview endpoint, say) could be
  // mistaken for the project link while generation is still in progress —
  // the fallback exists for "the user block's shape drifted," not as a
  // second place to look during every ordinary poll.
  const projectUrl = extractProjectUrl(parsed.userText) ?? (status === "ready" ? extractProjectUrl(parsed.raw) : null);
  return {
    status,
    projectId: parsed.orchestration?.projectId ?? fallbackProjectId ?? null,
    projectUrl,
    question: status === "needs_reply" ? parsed.userText || parsed.raw : null,
    raw: parsed.raw,
  };
}

export async function createPpt(
  session: DokieSession,
  topic: string,
  brief: string,
): Promise<StatusResult> {
  const parsed = await callTool(session, DOKIE_TOOLS.create, { topic, context: brief });
  return toStatusResult(parsed);
}

export async function replyPpt(
  session: DokieSession,
  projectId: string,
  answer: string,
): Promise<StatusResult> {
  const parsed = await callTool(session, DOKIE_TOOLS.reply, { projectId, message: answer });
  return toStatusResult(parsed, projectId);
}

export async function getStatus(
  session: DokieSession,
  projectId: string,
): Promise<StatusResult> {
  const parsed = await callTool(session, DOKIE_TOOLS.status, { projectId });
  return toStatusResult(parsed, projectId);
}

async function callTool(
  session: DokieSession,
  name: string,
  args: Record<string, unknown>,
): Promise<ParsedDokieResult> {
  try {
    const result = await session.client.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new TerminalError(
        `رفضت Dokie الطلب (${name}): ${allText(blocks(result)).slice(0, 500)}`,
        "SELECTOR_NOT_FOUND",
      );
    }
    return parseDokieResult(result);
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
