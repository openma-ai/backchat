import { expect, test } from "@playwright/test";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  launchAppWithHome,
  reloadRenderer,
  waitForRunnableHarness,
} from "./helpers";

/**
 * Real steering through pi. Needs a pi-acp build that negotiates
 * `_session/steering` (svkozak/pi-acp#115) and a configured pi provider.
 * Set OPENMA_REAL_PI_STEERING_E2E=1 and, optionally, PI_ACP_BIN.
 */
const realE2eEnabled = process.env["OPENMA_REAL_PI_STEERING_E2E"] === "1";
const piAcpCommand =
  process.env["PI_ACP_BIN"]
  || join(homedir(), ".oma", "acp", "bin", "openma-acp-pi-acp");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("steers a running pi turn from the composer with Enter", async ({}, testInfo) => {
  test.skip(
    !realE2eEnabled,
    "Set OPENMA_REAL_PI_STEERING_E2E=1 to run the model-dependent E2E",
  );
  test.skip(
    !(await pathExists(piAcpCommand)),
    `pi-acp is not installed at ${piAcpCommand}`,
  );

  test.setTimeout(300_000);
  const home = testInfo.outputPath("home");
  await mkdir(home, { recursive: true });

  const launched = await launchAppWithHome(home, { language: "en" });
  try {
    await launched.page.evaluate(
      async ({ piAcpCommand }) => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          default: {
            ...current.default,
            permission_mode: "ask",
            prompt_queue_enabled: true,
          },
          agents: [{
            id: "pi-acp",
            enabled: true,
            command_override: piAcpCommand,
            args_override: [],
            env: [],
          }],
        });
      },
      { piAcpCommand },
    );
    await reloadRenderer(launched.page);
    await waitForRunnableHarness(launched.page);

    const composer = launched.page.locator("textarea").first();
    await composer.fill(
      "Use the bash tool to run `sleep 20`. When it finishes, reply with exactly the single word DONE and nothing else.",
    );
    await composer.press("Enter");

    // pi's own editor sends Enter as a steer. Once the adapter negotiated the
    // extension the running composer offers exactly that; a stock pi-acp
    // would label this "Queue (Enter)" instead.
    await composer.fill(
      "Steering update from the user: after DONE, also print the English word for the number 7 in uppercase on its own line.",
    );
    const submit = launched.page.locator('[data-composer-submit="true"]');
    await expect(submit).toHaveAttribute("aria-label", "Steer (Enter)", {
      timeout: 60_000,
    });
    await composer.press("Enter");

    // The steered instruction reached the model mid-turn: the answer carries a
    // token that appears nowhere in the user's own text.
    await expect(launched.page.getByText(/\bSEVEN\b/)).toBeVisible({
      timeout: 240_000,
    });

    await testInfo.attach("pi steering real E2E", {
      body: await launched.page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await launched.cleanup();
  }
});
