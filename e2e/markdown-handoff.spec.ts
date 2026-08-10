import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

const RICH_MARKDOWN = [
  "# Heading one",
  "",
  "## Heading two",
  "",
  "### Heading three",
  "",
  "A paragraph with `inline code` and **bold** text that wraps a little.",
  "",
  "- first bullet",
  "- second bullet",
  "  - nested bullet",
  "",
  "1. numbered one",
  "2. numbered two",
  "",
  "```bash",
  "echo hello",
  "ls -la",
  "```",
  "",
  "> a quote line",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "---",
  "",
  "Final paragraph.",
].join("\n");

/** Every block's offset inside the answer, and its height. */
async function answerLayout(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const answer = document.querySelector("[data-session-turn-answer]");
    if (!answer) return [];
    const base = answer.getBoundingClientRect().top;
    return Array.from(
      answer.querySelectorAll("h1, h2, h3, h4, p, ul, ol, pre, blockquote, table, hr"),
    ).map((el) => {
      const box = el.getBoundingClientRect();
      return `${el.tagName}=${Math.round(box.top - base)}+${Math.round(box.height)}`;
    });
  });
}

test("the same markdown has the same geometry streaming and settled", async ({
  page,
}) => {
  // Two renderers draw an answer: streaming-markdown while it arrives, Streamdown
  // once it is done. Streamdown puts its own utility classes on each element, and
  // those classes only reach the stylesheet when our own source also uses them,
  // so the settled document was part generated and part inherited — headings,
  // lists and tables all disagreed with the streamed ones and the answer grew by
  // over a hundred pixels the moment the turn ended.
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-handoff";

  await injectEvent(page, {
    type: "session.prompt",
    session_id: sessionId,
    turn_id: turnId,
    text: "写点东西",
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: RICH_MARKDOWN },
      _meta: { codex: { phase: "final_answer" } },
    },
  });

  await expect
    .poll(() => answerLayout(page), { timeout: 30_000 })
    .toHaveLength(13);
  const streaming = await answerLayout(page);

  await injectEvent(page, {
    type: "session.complete",
    session_id: sessionId,
    turn_id: turnId,
    stop_reason: "end_turn",
  });
  await expect(page.locator("[data-turn-timestamp]").last()).toBeAttached();

  expect(await answerLayout(page)).toEqual(streaming);
});
