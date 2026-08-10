import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

/** Flattened order of the three landmarks inside the turn's response block. */
async function landmarkOrder(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-session-turn-response]");
    const out: string[] = [];
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
        if (/^PARA-ONE/.test(text) && !out.includes("PARA-ONE")) out.push("PARA-ONE");
        else if (/^PARA-TWO/.test(text) && !out.includes("PARA-TWO")) out.push("PARA-TWO");
        else if (/find-one/.test(text) && !out.includes("TOOL")) out.push("TOOL");
        walk(child);
      }
    };
    if (root) walk(root);
    return out;
  });
}

test("commentary after a tool call streams where it arrived", async ({ page }) => {
  // A tool call breaks the assistant text run, so the commentary after it is a
  // new segment. Only the first text of a turn published to React, so that
  // segment never mounted a live tail: the text stayed invisible for as long as
  // it streamed and then appeared, already whole, below the tool — the same
  // words seemingly moving down the transcript when the turn ended.
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-order";
  const chunk = (text: string) => ({
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      _meta: { codex: { phase: "commentary" } },
    },
  });

  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "数一下",
  });
  await injectEvent(page, chunk("PARA-ONE"));
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
  await injectEvent(page, chunk("PARA-TWO"));

  await expect
    .poll(() => landmarkOrder(page), { timeout: 15_000 })
    .toEqual(["PARA-ONE", "TOOL", "PARA-TWO"]);
});
