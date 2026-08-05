import { expect, test } from "./fixtures";

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
    await page.getByLabel("Name").fill("Wake up reminder");
    await page.getByLabel("Task instructions").fill("Tell me to wake up");
    await page.getByLabel("Source task").selectOption("schedule-source-task");
    await page.getByRole("button", { name: "Create schedule", exact: true }).click();

    await expect(page.getByText("Wake up reminder", { exact: true })).toBeVisible();
    await expect(page.getByText("Active", { exact: true }).last()).toBeVisible();
    await capture("scheduled-page.png", "scheduled page", true);
});
