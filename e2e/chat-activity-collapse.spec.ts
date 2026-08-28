import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("collapses completed activity continuously instead of flashing closed", async ({
  page,
}) => {
  // The shared E2E fixture disables motion globally for deterministic tests.
  // This test deliberately opts this disclosure back in so it can sample the
  // production height transition.
  await page.addStyleTag({
    content: ".reasoning-collapse-inner { transition-duration: 220ms !important; }",
  });
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

  const process = page.locator('[data-session-process-state]').last();
  const trigger = process.locator(':scope > [data-slot="collapsible-trigger"]');
  const content = process.locator(':scope > [data-slot="collapsible-content"]');
  await expect(process).toHaveAttribute("data-session-process-state", "running");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(content).toBeVisible();

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

  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(content).toBeVisible();
  await content.locator(":scope > .reasoning-collapse-inner").evaluate(
    async (node) => {
      await Promise.all(
        node.getAnimations().map((animation) => animation.finished),
      );
    },
  );
  const expandedHeight = await content.evaluate(
    (node) => node.getBoundingClientRect().height,
  );

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

  expect(expandedHeight).toBeGreaterThan(40);
  expect(
    heights.some((height) => height > 1 && height < expandedHeight - 1),
  ).toBe(true);
  expect(heights.at(-1)).toBeLessThan(1);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("keeps replayed completed activity visually closed and reopens nested tools", async ({
  page,
}) => {
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-replayed-activity-collapse";
  const send = (event: Record<string, unknown>) =>
    injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event,
    });

  await send({
    sessionUpdate: "agent_message_chunk",
    messageId: "replayed-commentary",
    _meta: { codex: { phase: "commentary" } },
    content: {
      type: "text",
      text: "Inspecting the workspace before reporting the result.",
    },
  });
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "replayed-read",
    status: "completed",
    kind: "read",
    title: "Read package.json",
    rawInput: { path: "package.json" },
  });
  await send({
    sessionUpdate: "agent_message_chunk",
    messageId: "replayed-answer",
    _meta: { codex: { phase: "final_answer" } },
    content: { type: "text", text: "The workspace inspection is complete." },
  });
  await injectEvent(page, {
    type: "session.complete",
    session_id: sessionId,
    turn_id: turnId,
  });

  // Switch away and back so the completed turn mounts directly in its closed
  // state, matching a history replay without relying on test-only persistence.
  await injectSession(page, {
    sessionId: "activity-collapse-away",
    agentId: "codex-acp",
  });
  await page.getByRole("button", {
    name: `codex-acp · ${sessionId.slice(0, 6)}`,
  }).click();

  const process = page.locator('[data-session-process-state="complete"]');
  const trigger = process.locator(':scope > [data-slot="collapsible-trigger"]');
  const content = process.locator(':scope > [data-slot="collapsible-content"]');
  const tool = process.locator('[data-tool-call-id="replayed-read"]');
  const toolTrigger = tool.locator(":scope > button");

  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(toolTrigger).toBeAttached();
  await expect
    .poll(() => content.evaluate((node) => node.getBoundingClientRect().height))
    .toBeLessThan(1);

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(toolTrigger).toBeVisible();

  await toolTrigger.click();
  await expect(
    tool.locator('[data-tool-input="replayed-read"]'),
  ).toBeVisible();
});
