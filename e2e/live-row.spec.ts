import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

/** The text of the work block's last row, and how many rows the block has. */
async function liveRow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const live = document.querySelector('[data-activity-live-work="true"]');
    // The wait line lives in the turn's footer; the work block's last row is the
    // only place that should speak while a turn has work to report.
    const waits = document.querySelectorAll(
      "[data-session-turn-response] [aria-live]",
    ).length;
    return {
      text: (live?.textContent ?? "").replace(/\s+/g, " ").trim(),
      rows: live?.children.length ?? 0,
      foldable: Boolean(live?.querySelector("[data-tool-group-trigger]")),
      waits,
    };
  });
}

test("the last row says what the turn is doing, and folds the tools into it", async ({
  page,
}) => {
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-live";
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
    text: "看看仓库",
  });

  // Nothing to report yet: the row says it is thinking, and says it once.
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    status: "completed",
    kind: "read",
    title: "Read package.json",
  });
  await expect.poll(() => liveRow(page)).toMatchObject({ rows: 1, waits: 0 });

  // A running command outranks the fallback.
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "t2",
    status: "in_progress",
    kind: "execute",
    title: "/bin/zsh -lc 'glab pipeline list'",
  });
  await expect
    .poll(() => liveRow(page).then((row) => row.text))
    .toContain("glab pipeline list");

  // A thought streams beside the running tool: it is a block of its own, and the
  // command stays reported. Ranking the block above the command left the command
  // reported by nothing at all.
  await send({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "等流水线结果" },
  });
  await expect(page.locator('[data-thought-block="true"]')).toBeAttached();
  await expect.poll(() => liveRow(page)).toMatchObject({
    rows: 1,
    foldable: true,
  });
  expect((await liveRow(page)).text).toContain("glab pipeline list");
});

test("nothing says it is thinking while the answer is still arriving", async ({
  page,
}) => {
  // The work block's last row had its own fallback, so a turn that had already
  // run a tool went back to saying "thinking" underneath text that was still
  // being written.
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-quiet";
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
    text: "看看仓库",
  });
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    status: "completed",
    kind: "read",
    title: "Read package.json",
  });
  await send({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "读完了，接下来说结论。" },
    _meta: { codex: { phase: "final_answer" } },
  });

  const saidThinking = () =>
    page.evaluate(() => {
      const turn = document.querySelector("[data-session-turn-response]");
      const text = (turn?.textContent ?? "").replace(/\s+/g, " ");
      return /Thinking|思考中/.test(text);
    });
  await expect.poll(saidThinking, { timeout: 10_000 }).toBe(false);
});

test("the live row is the agent talking, not a control", async ({ page }) => {
  // It had a control's furniture: a list icon before the words and a "2 tool
  // calls ›" chip after them, which is neither what it is doing nor something
  // the reader asked about.
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-bare";
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
    text: "看看仓库",
  });
  for (const id of ["t1", "t2"]) {
    await send({
      sessionUpdate: "tool_call",
      toolCallId: id,
      status: "completed",
      kind: "read",
      title: `Read ${id}.json`,
    });
  }
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "t3",
    status: "in_progress",
    kind: "execute",
    title: "/bin/zsh -lc 'cargo test'",
  });

  const row = page.locator('[data-activity-live-work="true"]');
  await expect(row).toContainText("cargo test");
  // Only the command. Not how many tools it took to get here.
  await expect(row).not.toContainText(/tool calls|个工具调用/);

  // A running command is still a tool call and keeps the row's icon. The
  // fallback is the row talking about itself, and gets none.
  expect(await row.locator("svg").count()).toBeGreaterThan(0);
  await send({
    sessionUpdate: "tool_call_update",
    toolCallId: "t3",
    status: "completed",
    kind: "execute",
    title: "/bin/zsh -lc 'cargo test'",
  });
  await expect.poll(() => liveRow(page).then((r) => r.text)).toMatch(
    /Thinking|思考中/,
  );
  expect(await row.locator("svg").count()).toBe(0);
});
