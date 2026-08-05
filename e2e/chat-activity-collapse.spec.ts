import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("collapses completed activity continuously instead of flashing closed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-smooth-activity-collapse";

  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      messageId: "activity-commentary",
      _meta: { codex: { phase: "commentary" } },
      content: {
        type: "text",
        text: [
          "Inspecting the current workspace before making the change.",
          "Comparing the active disclosure geometry with the surrounding transcript.",
          "Running the focused verification and checking the final layout.",
        ].join("\n\n"),
      },
    },
  });
  await injectEvent(page, {
    type: "session.event",
    session_id: sessionId,
    turn_id: turnId,
    event: {
      sessionUpdate: "agent_message_chunk",
      messageId: "activity-answer",
      _meta: { codex: { phase: "final_answer" } },
      content: { type: "text", text: "The verification is complete." },
    },
  });
  await injectEvent(page, {
    type: "session.complete",
    session_id: sessionId,
    turn_id: turnId,
  });

  const trigger = page.locator('[data-slot="collapsible-trigger"]').last();
  const content = page.locator('[data-slot="collapsible-content"]').last();
  await expect(trigger).toBeVisible();
  await expect(content).toBeVisible();

  const heights = await content.evaluate(async (node) => {
    const disclosure = node as HTMLElement;
    const trigger = disclosure.parentElement?.querySelector<HTMLButtonElement>(
      '[data-slot="collapsible-trigger"]',
    );
    if (!trigger) throw new Error("activity disclosure trigger is missing");

    const samples: number[] = [disclosure.getBoundingClientRect().height];
    trigger.click();
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const sample = (now: number) => {
        samples.push(disclosure.getBoundingClientRect().height);
        if (now - startedAt >= 320) {
          resolve();
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return samples;
  });

  const expandedHeight = heights[0]!;
  expect(expandedHeight).toBeGreaterThan(40);
  expect(
    heights.some((height) => height > 1 && height < expandedHeight - 1),
  ).toBe(true);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
