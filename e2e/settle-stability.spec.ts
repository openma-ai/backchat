import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

/** Geometry of everything the work block renders above its live status line. */
async function activityBoxes(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const content =
      document.querySelector(".reasoning-collapse-inner .space-y-1") ??
      document.querySelector(".reasoning-collapse-inner > div");
    if (!content) return [];
    return Array.from(content.children)
      // Everything above the live row. That row is the turn's own report of what
      // it is doing now, and it is meant to collapse when the turn ends; what
      // must not move is everything the user was already reading.
      .filter(
        (el) =>
          !el.hasAttribute("data-activity-status-row") &&
          !el.hasAttribute("data-activity-live-work"),
      )
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return `${Math.round(rect.top)}+${Math.round(rect.height)}`;
      });
  });
}

test("settling a turn does not move what the turn already rendered", async ({
  page,
}) => {
  // Settling used to relay the whole block: a summary row appeared above it, the
  // collapsed content gained padding, the running tool's row lost the height of
  // its status pill, and the live status line was removed outright. Everything
  // the user had been reading jumped.
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-settle";
  const chunk = (text: string, phase: string) => ({
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      _meta: { codex: { phase } },
    },
  });

  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "数一下",
  });
  await injectEvent(page, chunk("PARA-ONE", "commentary"));
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      status: "pending",
      title: "/bin/zsh -lc find-one",
      kind: "execute",
    },
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "THOUGHT-LINE" },
    },
  });
  await injectEvent(page, chunk("PARA-TWO", "commentary"));
  await injectEvent(page, chunk("FINAL-ANSWER-TEXT", "final_answer"));

  // Commentary, tool row, commentary. Codex's thinking block is not among them:
  // it is a passing state, drawn while the agent reasons and gone once it moves
  // on, so it is never one of the boxes a settling turn could shift.
  await expect.poll(() => activityBoxes(page), { timeout: 15_000 }).toHaveLength(3);
  const streaming = await activityBoxes(page);

  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
      title: "/bin/zsh -lc find-one",
      kind: "execute",
    },
  });
  await injectEvent(page, {
    type: "session.complete",
    session_id: sessionId,
    turn_id: turnId,
    stop_reason: "end_turn",
  });
  await expect(
    page.locator("[data-session-turn-response] [data-turn-timestamp]").first(),
  ).toBeAttached();

  expect(await activityBoxes(page)).toEqual(streaming);
});
