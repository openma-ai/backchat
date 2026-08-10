import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("a streaming paragraph shows its newest character while the turn runs", async ({
  page,
}) => {
  // streaming-markdown holds the last character back until more text arrives or
  // the document ends, so the newest character of every pause stayed invisible
  // and the text appeared to stutter one character behind the agent.
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-tail";
  const paragraph = "我会查找所有 .git 标记。";
  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "数一下",
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: paragraph },
    },
  });

  const answer = page.locator('[data-session-turn-answer="true"]').first();
  await expect(answer).toBeVisible();
  // The turn is still running: no completion event has been sent.
  await expect(answer).toContainText(paragraph, { timeout: 15_000 });
});
