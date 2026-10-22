import { writeFileSync } from "node:fs";

import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

/**
 * A turn settling (ACP stop) must not move anything already on screen: the
 * process stays where the reader left it, the streamed answer keeps its
 * geometry when the settled renderer takes over, and the footer appears in
 * space that was already reserved for it.
 */
test("a settling turn does not move the transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-settle-layout";
  const send = (event: Record<string, unknown>) =>
    injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event,
    });

  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "检查仓库并总结",
  });
  await send({
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought-1",
    content: { type: "text", text: "先看看仓库结构，再读配置。" },
  });
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "read-1",
    status: "completed",
    kind: "read",
    title: "Read package.json",
    rawInput: { path: "package.json" },
  });
  await send({
    sessionUpdate: "agent_message_chunk",
    messageId: "commentary-1",
    _meta: { codex: { phase: "commentary" } },
    content: { type: "text", text: "配置读完了，接着跑测试确认现状。" },
  });
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "run-1",
    status: "completed",
    kind: "execute",
    title: "pnpm test",
    rawInput: { command: "pnpm test" },
  });
  const answer = [
    "## 结论",
    "",
    "仓库结构清晰，测试全部通过。下面是要点：",
    "",
    "- 入口在 `src/main/index.ts`",
    "- 渲染层使用 **TanStack Router**",
    "- 设置保存在 `~/.oma/config.toml`",
    "",
    "```ts",
    "export const answer = 42;",
    "```",
    "",
    "以上就是全部。",
  ].join("\n");
  for (const chunk of answer.match(/[\s\S]{1,12}/g) ?? []) {
    await send({
      sessionUpdate: "agent_message_chunk",
      messageId: "answer-1",
      _meta: { codex: { phase: "final_answer" } },
      content: { type: "text", text: chunk },
    });
  }

  const turn = page.locator(`article[data-turn-id="${turnId}"]`);
  await expect(turn.locator("[data-session-turn-answer]")).toContainText(
    "以上就是全部。",
    { timeout: 15_000 },
  );
  // Let the pacer drain and layout settle.
  await page.waitForTimeout(600);

  const snapshot = (label: string) =>
    turn.evaluate((root, label) => {
      const top = (node: Element | null) =>
        node ? Math.round(node.getBoundingClientRect().top * 10) / 10 : null;
      let scroller = root.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      const response = root.querySelector("[data-session-turn-response]");
      const answerNode = root.querySelector("[data-session-turn-answer]");
      const firstAnswerBlock = answerNode?.querySelector(".chat-markdown > *");
      const lastAnswerBlock = answerNode?.querySelector(".chat-markdown > :last-child");
      return {
        label,
        header: top(root.querySelector("[data-session-process-state] > button")),
        processBlocks: [
          ...root.querySelectorAll("[data-session-process-activity]:not([hidden]) > *"),
        ].map(top),
        answer: top(answerNode),
        answerFirst: top(firstAnswerBlock ?? null),
        answerLast: top(lastAnswerBlock ?? null),
        answerHeight: answerNode
          ? Math.round(answerNode.getBoundingClientRect().height * 10) / 10
          : null,
        responseHeight: response
          ? Math.round(response.getBoundingClientRect().height * 10) / 10
          : null,
        footer: top(root.querySelector("[data-turn-footer]")),
        scrollTop: scroller?.scrollTop ?? null,
        scrollHeight: scroller?.scrollHeight ?? null,
      };
    }, label);

  const before = await snapshot("streaming");
  if (process.env["SETTLE_LAYOUT_HTML"]) {
    writeFileSync(
      process.env["SETTLE_LAYOUT_HTML"],
      await turn.locator("[data-session-turn-answer]").evaluate((node) => {
        const walk = (el: Element, depth: number): string =>
          `${"  ".repeat(depth)}<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}"> mt=${getComputedStyle(el).marginTop} mb=${getComputedStyle(el).marginBottom} h=${Math.round(el.getBoundingClientRect().height)} top=${Math.round(el.getBoundingClientRect().top)}\n` +
          (depth < 4 ? [...el.children].map((c) => walk(c, depth + 1)).join("") : "");
        return walk(node, 0);
      }),
    );
  }
  await injectEvent(page, {
    type: "session.complete",
    session_id: sessionId,
    turn_id: turnId,
  });
  await expect(turn.locator("[data-turn-footer]")).toHaveCount(1);
  await page.waitForTimeout(600);
  const after = await snapshot("settled");

  const out = process.env["SETTLE_LAYOUT_OUT"];
  if (out) writeFileSync(out, JSON.stringify({ before, after }, null, 2));

  // Everything that was on screen while streaming stays where it was.
  expect(after.header).toBe(before.header);
  expect(after.processBlocks).toEqual(before.processBlocks);
  expect(after.answer).toBe(before.answer);
  expect(after.answerFirst).toBe(before.answerFirst);
  expect(after.answerHeight).toBe(before.answerHeight);
  // The footer lands in reserved space: the response does not grow.
  expect(after.responseHeight).toBe(before.responseHeight);
});

test("the thinking fallback sits one block gap under the process header", async ({
  page,
}) => {
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-thinking-gap";
  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "你好",
  });
  // The first turn event marks the prompt accepted; nothing visible yet.
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "" } },
  });
  const turn = page.locator(`article[data-turn-id="${turnId}"]`);
  const fallback = turn.locator('[data-thinking-fallback="true"]');
  await expect(fallback).toBeVisible();
  const gap = await turn.evaluate((root) => {
    const header = root.querySelector("[data-session-process-state] > button");
    const status = root.querySelector('[data-thinking-fallback="true"]');
    if (!header || !status) return null;
    return Math.round(
      status.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
    );
  });
  expect(gap).toBe(12);
});
