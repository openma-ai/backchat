import { expect, test } from "./fixtures";

import { enableAgent, injectSession } from "./helpers";

const RAIL = "aside[data-right-panel-collapsed]";

test.describe("right rail", () => {
  test("a newly created chat does not inherit an opened rail", async ({ page }) => {
    await enableAgent(page, "codex-acp");
    await injectSession(page, { sessionId: "rail-first", agentId: "codex-acp" });

    const rail = page.locator(RAIL);
    await expect(rail).toHaveAttribute("data-right-panel-collapsed", "true");

    // Open it for this chat.
    await page.getByRole("button", { name: "Open side panel" }).click();
    await expect(rail).toHaveAttribute("data-right-panel-collapsed", "false");

    // A brand new chat has nothing to show in the rail. Before the fix the
    // open state was a single stored flag, so it arrived open and empty.
    await injectSession(page, { sessionId: "rail-second", agentId: "codex-acp" });
    await expect(rail).toHaveAttribute("data-right-panel-collapsed", "true");
  });

  test("returning to a chat restores the rail left there", async ({ page }) => {
    await enableAgent(page, "codex-acp");
    await injectSession(page, { sessionId: "rail-a", agentId: "codex-acp" });

    const rail = page.locator(RAIL);
    await page.getByRole("button", { name: "Open side panel" }).click();
    await expect(rail).toHaveAttribute("data-right-panel-collapsed", "false");

    await injectSession(page, { sessionId: "rail-b", agentId: "codex-acp" });
    await expect(rail).toHaveAttribute("data-right-panel-collapsed", "true");

    await page
      .getByRole("navigation")
      .getByRole("button", { name: "codex-acp · rail-a", exact: true })
      .click();
    await expect(rail).toHaveAttribute("data-right-panel-collapsed", "false");
  });
});
