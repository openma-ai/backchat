import { expect, test } from "./fixtures";
import { injectEvent, injectSession } from "./helpers";

test("active tool tail preserves state and nested indentation", async ({
  page,
}) => {
  const sessionId = await injectSession(page, { agentId: "codex-acp" });
  const turnId = "turn-icon-rail";
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
    text: "检查仓库",
  });
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "read-finished",
    status: "completed",
    kind: "read",
    title: "Read package.json",
    rawInput: { path: "package.json" },
  });

  const completedTailGroup = page.locator('[data-tool-group-size="1"]');
  await expect(completedTailGroup.locator(":scope > button")).toContainText(
    /Reading.*package\.json/,
  );
  await expect(
    completedTailGroup.locator('[data-tool-call-id="read-finished"]'),
  ).toContainText(/Read.*package\.json/);
  await expect(page.locator('[data-thinking-fallback="true"]')).toHaveCount(0);

  await send({
    sessionUpdate: "tool_call",
    toolCallId: "run-live",
    status: "in_progress",
    kind: "execute",
    title: "pnpm test",
  });

  const group = page.locator('[data-tool-group-size="2"]');
  const trigger = group.locator(":scope > button");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const innerRow = group
    .locator('[data-tool-call-id="read-finished"]')
    .locator(":scope > button");
  const innerTool = group.locator('[data-tool-call-id="read-finished"]');
  const outerIcon = trigger.locator(".chat-activity-icon").first();
  const innerIcon = innerRow.locator(".chat-activity-icon").first();
  const innerLabel = innerRow
    .locator('[data-tool-activity-identity] > span')
    .first();
  await expect(outerIcon).toBeVisible();
  await expect(innerIcon).toBeVisible();

  const [
    groupBox,
    innerToolBox,
    outerRowBox,
    innerRowBox,
    outerIconBox,
    innerIconBox,
  ] = await Promise.all([
    group.boundingBox(),
    innerTool.boundingBox(),
    trigger.boundingBox(),
    innerRow.boundingBox(),
    outerIcon.boundingBox(),
    innerIcon.boundingBox(),
  ]);
  expect(groupBox).not.toBeNull();
  expect(innerToolBox).not.toBeNull();
  expect(outerRowBox).not.toBeNull();
  expect(innerRowBox).not.toBeNull();
  expect(outerIconBox).not.toBeNull();
  expect(innerIconBox).not.toBeNull();

  // Each hover surface stays inside its own hierarchy box. Padding moves its
  // contents inward; it must not pull the background into the parent gutter.
  expect(outerRowBox!.x).toBeCloseTo(groupBox!.x, 1);
  expect(outerRowBox!.width).toBeCloseTo(groupBox!.width, 1);
  expect(innerRowBox!.x).toBeCloseTo(innerToolBox!.x, 1);
  expect(innerRowBox!.width).toBeCloseTo(innerToolBox!.width, 1);
  expect(outerIconBox!.x - outerRowBox!.x).toBeCloseTo(8, 1);
  expect(innerIconBox!.x - innerRowBox!.x).toBeCloseTo(8, 1);
  expect(innerIconBox!.x - outerIconBox!.x).toBeGreaterThanOrEqual(24);

  await innerRow.click();
  const [labelBox, inputBox] = await Promise.all([
    innerLabel.boundingBox(),
    group.locator('[data-tool-input="read-finished"]').boundingBox(),
  ]);
  expect(labelBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.x).toBeCloseTo(labelBox!.x, 1);
});
