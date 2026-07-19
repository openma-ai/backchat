import { expect, test } from "@playwright/test";
import { launchApp, persistSessionFixture } from "./helpers";

test("settings activity summarizes persisted work by harness", async ({}, testInfo) => {
  const { page, cleanup } = await launchApp();
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await persistSessionFixture(page, {
      sessionId: "activity-codex-one",
      agentId: "codex-acp",
      events: [
        { type: "user_prompt", data: { text: "Build the activity panel" } },
        { type: "tool_call", data: { title: "Edit settings" } },
        { type: "tool_call_update", data: { status: "completed" } },
      ],
    });
    await persistSessionFixture(page, {
      sessionId: "activity-codex-two",
      agentId: "codex-acp",
      events: [{ type: "user_prompt", data: { text: "Review the panel" } }],
    });
    await persistSessionFixture(page, {
      sessionId: "activity-claude",
      agentId: "claude-acp",
      events: [
        { type: "user_prompt", data: { text: "Check the metrics" } },
        { type: "tool_call", data: { title: "Run tests" } },
      ],
    });

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Activity", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expect(page.getByText("Stored on this device")).toBeVisible();
    await expect(page.locator("p").filter({ hasText: /^Codex$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("p").filter({ hasText: /^Claude$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('img[alt="Codex"], svg[aria-label="Codex"]')).toBeVisible();
    await expect(page.locator('img[alt="Claude"], svg[aria-label="Claude"]')).toBeVisible();
    const registryIcon = page.locator('img[alt="Codex"]');
    if (await registryIcon.count()) {
      await expect(registryIcon).toHaveAttribute("src", /cdn\.agentclientprotocol\.com/);
      await expect.poll(() => registryIcon.evaluate((image) =>
        image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await expect(page.getByRole("button", { name: "Turns" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Tools" }).click();
    await expect(page.getByRole("button", { name: "Tools" })).toHaveAttribute("aria-pressed", "true");

    const screenshotPath = testInfo.outputPath("settings-activity.png");
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("settings activity", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await cleanup();
  }
});
