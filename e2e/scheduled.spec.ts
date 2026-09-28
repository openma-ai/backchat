import { expect, test } from "./fixtures";
import { enableAgent } from "./helpers";

test("creates a schedule before any task exists", async ({ page, bridge, capture }) => {
  await bridge.setAgentSetupFixture({
    agents: [{ id: "codex-acp", label: "Codex", command: "codex-acp", detected: true, available: true, installed: true }],
  });
  await enableAgent(page, "codex-acp");

  await page.getByRole("link", { name: "Scheduled", exact: true }).click();
  const newSchedule = page.getByRole("button", { name: "New schedule" });
  await expect(newSchedule).toBeEnabled();
  await capture("scheduled-empty.png", "empty scheduled page");
  await newSchedule.click();
  await page.getByRole("menuitem", { name: "Set up manually" }).click();
  await expect(page.getByRole("heading", { name: "Create schedule" })).toBeVisible();
  await capture("scheduled-manual-form.png", "manual schedule form");
  await page.getByLabel("Name").fill("Daily summary");
  await page.getByLabel("Task instructions").fill("Summarize today's work");
  await page.getByLabel("Harness").selectOption("codex-acp");
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();

  await expect(page.getByText("Daily summary", { exact: true })).toBeVisible();
  const schedules = await page.evaluate(() => window.backchat.schedulesList());
  expect(schedules).toMatchObject([{ sourceSessionId: "", agentId: "codex-acp", target: "new_task" }]);
  await capture("scheduled-created.png", "created scheduled task");
});

test("opens a reviewable Codex setup draft", async ({ page, capture }) => {
  await page.getByRole("link", { name: "Scheduled", exact: true }).click();
  await page.getByRole("button", { name: "New schedule" }).click();
  await page.getByRole("menuitem", { name: "Create with Codex" }).click();

  await expect(page.locator("textarea").first()).toHaveValue(/Help me set up a scheduled task in Backchat/);
  await capture("scheduled-codex-draft.png", "Codex setup draft");
});

test("creates and manages a one-time scheduled task", async ({ page, bridge, capture }) => {
    await bridge.persistSessionFixture({
      sessionId: "schedule-source-task",
      agentId: "codex-acp",
      cwd: "/tmp/openma-scheduled-e2e",
      acpSessionId: "acp-schedule-source",
      title: "Schedule source",
      events: [{ type: "user_prompt", data: { text: "Create a reminder" } }],
    });

    await page.getByRole("link", { name: "Scheduled", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Scheduled" })).toBeVisible();
    await page.getByRole("button", { name: "New schedule" }).click();
    await page.getByRole("menuitem", { name: "Set up manually" }).click();
    await page.getByLabel("Name").fill("Wake up reminder");
    await page.getByLabel("Task instructions").fill("Tell me to wake up");
    await page.getByLabel("Source task").selectOption("schedule-source-task");
    await page.getByRole("button", { name: "Create schedule", exact: true }).click();

    await expect(page.getByText("Wake up reminder", { exact: true })).toBeVisible();
    const schedules = await page.evaluate(() => window.backchat.schedulesList());
    expect(schedules).toMatchObject([{ sourceSessionId: "schedule-source-task", target: "current_task" }]);
    await capture("scheduled-page.png", "scheduled page", true);
});
