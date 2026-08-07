import assert from "node:assert/strict";
import test from "node:test";

import { createPpt, replyPpt, getStatus, DOKIE_TOOLS } from "../dist/providers/dokie.js";
import { TerminalError } from "../dist/stages.js";

/**
 * Runs against dist, so `pnpm build` first (the test script does it).
 *
 * Fixtures mirror the real GET /dokie/tools shape: an `assistant`-audience
 * block carrying an orchestration JSON (projectId, phase, nextAction, ...)
 * and a separate `user`-audience block carrying what a producer should see.
 * These pin the split so a future edit can't quietly go back to keyword
 * regex over the two blended together.
 */

function assistantBlock(orchestration) {
  return { type: "text", text: JSON.stringify(orchestration), annotations: { audience: ["assistant"] } };
}

function userBlock(text) {
  return { type: "text", text, annotations: { audience: ["user"] } };
}

function fakeSession(content, isError = false) {
  return {
    client: { callTool: async () => ({ content, isError }) },
    close: async () => {},
  };
}

test("§6.4 a fresh project with no checkpoint yet is pending, not ready or needs_reply", async () => {
  const content = [
    assistantBlock({
      projectId: "proj_1",
      phase: "init",
      running: true,
      nextAction: "get_project_status",
    }),
  ];
  const result = await createPpt(fakeSession(content), "مقدمة في الشبكات", "brief text");
  assert.equal(result.status, "pending");
  assert.equal(result.projectId, "proj_1");
  assert.equal(result.question, null);
});

test("§6.4 wait_for_user surfaces the user-audience block, not the orchestration JSON", async () => {
  const userText =
    "معاينة الموضوع: ![preview](https://dokie.ai/preview/proj_1.png)\n" +
    "المخطط المقترح:\n1. مقدمة\n2. التفاصيل\nهل تؤكد المتابعة؟";
  const content = [
    assistantBlock({
      projectId: "proj_1",
      phase: "outline",
      nextAction: "wait_for_user",
      confirmationStep: "outline_confirmation",
      agentInstructions: "Forward the user-audience block verbatim and wait for a reply.",
    }),
    userBlock(userText),
  ];
  const result = await createPpt(fakeSession(content), "مقدمة في الشبكات", "brief text");
  assert.equal(result.status, "needs_reply");
  assert.equal(result.question, userText);
  // The abbreviated orchestration fields must not leak into what a producer reads.
  assert.ok(!result.question.includes("confirmationStep"));
  assert.ok(!result.question.includes("agentInstructions"));
});

test("§6.4 phase done with a project link in the user block is ready", async () => {
  const content = [
    assistantBlock({
      projectId: "proj_1",
      phase: "done",
      running: false,
      completedPages: 8,
      totalPages: 8,
      nextAction: "done",
    }),
    userBlock("اكتمل توليد العرض! رابط المشروع: https://dokie.ai/p/proj_1"),
  ];
  const result = await getStatus(fakeSession(content), "proj_1");
  assert.equal(result.status, "ready");
  assert.equal(result.projectUrl, "https://dokie.ai/p/proj_1");
});

test("§6.4 a URL inside the assistant JSON is not mistaken for the project link", async () => {
  const content = [
    assistantBlock({
      projectId: "proj_1",
      phase: "generated",
      nextAction: "get_project_status",
      debugUrl: "https://internal.dokie.ai/debug/proj_1",
    }),
    userBlock("جارٍ العمل على الشرائح، برجاء الانتظار."),
  ];
  const result = await getStatus(fakeSession(content), "proj_1");
  // No project link in the user-facing block yet — must not fall back to
  // scraping the assistant JSON's unrelated debugUrl.
  assert.equal(result.projectUrl, null);
  assert.equal(result.status, "pending");
});

test("§6.4 an unparseable or missing orchestration block degrades to pending, not a crash", async () => {
  const result = await getStatus(fakeSession([]), "proj_1");
  assert.equal(result.status, "pending");
  assert.equal(result.projectId, "proj_1", "falls back to the projectId the caller already knew");
});

test("§6.4 reply_dokie sends exactly {projectId, message} — the confirmed schema", async () => {
  let seen;
  const session = {
    client: {
      callTool: async (call) => {
        seen = call;
        return { content: [assistantBlock({ projectId: "proj_1", phase: "outline", nextAction: "get_project_status" })] };
      },
    },
    close: async () => {},
  };
  await replyPpt(session, "proj_1", "أكّد المتابعة");
  assert.equal(seen.name, DOKIE_TOOLS.reply);
  assert.deepEqual(seen.arguments, { projectId: "proj_1", message: "أكّد المتابعة" });
});

test("§6.4 an isError result still throws TerminalError with the readable text, not the flattened JSON", async () => {
  const content = [userBlock("رُفض الطلب: topic مطلوب.")];
  await assert.rejects(
    () => createPpt(fakeSession(content, true), "", "brief"),
    (err) => {
      assert.ok(err instanceof TerminalError);
      assert.equal(err.code, "SELECTOR_NOT_FOUND");
      assert.ok(err.message.includes("topic مطلوب"));
      return true;
    },
  );
});
