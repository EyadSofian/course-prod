import { eq } from "drizzle-orm";
import { assertBudget, estimateDeckCents } from "@course-prod/core/costs";
import { getDb, lessons } from "@course-prod/core/db";
import {
  buildDeckBrief,
  connect,
  createPpt,
  getStatus,
  pollUntilDone,
  replyPpt,
} from "@course-prod/core/providers/dokie";
import { TerminalError } from "@course-prod/core/stages";
import type { StageContext, StageOutcome } from "../runner.js";

/**
 * §6.4 — deck generation through the Dokie MCP.
 *
 * Two rules dominate the shape of this file:
 *   - nothing retries automatically; credits are real money (§13)
 *   - an outline question is a pause for a human, not a failure
 */
export async function handleDeck(ctx: StageContext): Promise<StageOutcome> {
  const { lesson, settings, log } = ctx;
  const lessonJson = lesson.lessonJson;

  if (!lessonJson) {
    throw new TerminalError("لا يوجد درس مُهيكل. أكمل المراجعة والاعتماد أولاً.", "INVARIANT_VIOLATION");
  }

  // §6.4 hard cap. Checked before spending, and phrased so the producer knows
  // which lever to pull.
  if (lessonJson.slides.length > settings.slideCap) {
    throw new TerminalError(
      `الدرس ${lessonJson.slides.length} شريحة والحد ${settings.slideCap}. ` +
        `احذف الشرائح الزائدة من المراجعة، أو ارفع الحد من الإعدادات قبل توليد العرض.`,
      "LIMIT_EXCEEDED",
    );
  }

  const estimate = estimateDeckCents(lessonJson.slides.length, settings);
  await assertBudget(estimate, settings);

  const session = await connect();
  try {
    // Resume an in-flight project rather than starting a second one. Without
    // this, answering an outline question would generate a fresh deck and
    // bill twice.
    let state = lesson.dokieProjectId
      ? await getStatus(session, lesson.dokieProjectId)
      : await createPpt(session, lessonJson.title_ar, buildDeckBrief(lessonJson));

    ctx.record({
      slides: lessonJson.slides.length,
      estimated_cents: estimate,
      resumed: Boolean(lesson.dokieProjectId),
      initial_status: state.status,
    });

    if (state.projectId) {
      await getDb()
        .update(lessons)
        .set({ dokieProjectId: state.projectId, updatedAt: new Date() })
        .where(eq(lessons.id, lesson.id));
    }

    // A queued answer from the UI is delivered here.
    if (state.status === "needs_reply" && lesson.dokiePendingQuestion === null && state.projectId) {
      log.info("dokie asked for confirmation");
    }

    if (state.status !== "ready" && state.projectId) {
      state = await pollUntilDone(session, state.projectId, {
        onPoll: (n, s) => log.debug("poll", { n, status: s.status }),
      });
    }

    if (state.status === "needs_reply") {
      // Pause, do not fail. §5's state machine has no "waiting" state, so the
      // lesson stays REVIEWED with the question surfaced; the UI shows a
      // pending approval and calls back with reply_ppt.
      await getDb()
        .update(lessons)
        .set({
          dokiePendingQuestion: state.question ?? state.raw.slice(0, 4_000),
          dokieProjectId: state.projectId,
          updatedAt: new Date(),
        })
        .where(eq(lessons.id, lesson.id));

      ctx.record({ paused_for: "outline_confirmation" });
      log.info("paused awaiting outline confirmation");
      return { status: "REVIEWED", halt: true };
    }

    if (!state.projectUrl) {
      throw new TerminalError(
        "أنهت Dokie التوليد دون إرجاع رابط المشروع. افتح Dokie وتحقّق يدوياً قبل إعادة التوليد.",
        "SELECTOR_NOT_FOUND",
        { raw: state.raw.slice(0, 4_000) },
      );
    }

    // Credits are consumed by the generation, not by our estimate — but Dokie
    // reports no price, so the estimate is what we book (§7 labels it as such).
    ctx.charge(estimate);
    await getDb()
      .update(lessons)
      .set({
        dokieProjectUrl: state.projectUrl,
        dokieProjectId: state.projectId,
        dokiePendingQuestion: null,
        updatedAt: new Date(),
      })
      .where(eq(lessons.id, lesson.id));

    ctx.record({ project_url: state.projectUrl });
    log.info("deck generated", { project_url: state.projectUrl });
    return {};
  } finally {
    await session.close();
  }
}

/**
 * Answers a pending outline question (§6.4). Invoked from the UI, not the
 * queue, because the answer is a human decision.
 */
export async function answerDeckQuestion(lessonId: string, answer: string): Promise<void> {
  const db = getDb();
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson?.dokieProjectId) {
    throw new TerminalError("لا يوجد سؤال معلّق لهذا الدرس.", "INVARIANT_VIOLATION");
  }

  const session = await connect();
  try {
    await replyPpt(session, lesson.dokieProjectId, answer);
    await db
      .update(lessons)
      .set({ dokiePendingQuestion: null, updatedAt: new Date() })
      .where(eq(lessons.id, lessonId));
  } finally {
    await session.close();
  }
}
