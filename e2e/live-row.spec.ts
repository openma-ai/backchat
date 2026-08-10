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

  // A thought outranks the command, and the tools fold into the same row.
  await send({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "等流水线结果" },
  });
  await expect.poll(() => liveRow(page)).toMatchObject({
    rows: 1,
    foldable: true,
  });
  expect((await liveRow(page)).text).toContain("等流水线结果");
});
