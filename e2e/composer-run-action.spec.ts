import { expect, test } from "./fixtures";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { reloadRenderer, waitForRunnableHarness } from "./helpers";

const fakeAcpAgentPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-acp-agent.mjs",
);

test.describe("composer run action", () => {
  test("one slot swaps between send and stop by context", async ({ page, composer }) => {
    await page.evaluate(
      async ({ nodePath, fakeAgentPath }) => {
        await window.backchat.settingsPatch({
          agents: [{
            id: "codex-acp",
            enabled: true,
            command_override: nodePath,
            args_override: [fakeAgentPath],
            env: [],
          }],
        });
      },
      { nodePath: process.execPath, fakeAgentPath: fakeAcpAgentPath },
    );
    await reloadRenderer(page);
    await waitForRunnableHarness(page);

    const draftInput = page.locator(".new-chat-page textarea").last();
    const submit = page.locator('[data-composer-submit="true"]');
    const stop = page.locator('[data-composer-stop="true"]');

    // Idle and empty: the slot offers send, disabled.
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(stop).toHaveCount(0);

    // Start a turn the fake agent holds open.
    await draftInput.fill("stall-until-cancelled-e2e");
    await draftInput.press("Enter");

    const chatInput = page.locator('[data-chat-surface="main"] textarea').last();
    // Running with an empty composer: the same slot becomes stop.
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await expect(submit).toHaveCount(0);

    // Typing restores the send/queue meaning, so Enter and the button agree.
    await chatInput.fill("queue me");
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(stop).toHaveCount(0);

    // Clearing it hands the slot back to stop, which cancels the turn.
    await chatInput.fill("");
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(submit).toBeVisible({ timeout: 15_000 });
    await expect(stop).toHaveCount(0);
    void composer;
  });
});
