import { expect, test } from "@playwright/test";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  launchAppWithHome,
  reloadRenderer,
  waitForRunnableHarness,
} from "./helpers";

const realE2eEnabled = process.env["OPENMA_REAL_PI_COMPUTER_USE_E2E"] === "1";
const piAcpCommand = join(homedir(), ".openma", "acp", "bin", "openma-acp-pi-acp");
const piComputerUsePackage = join(
  homedir(),
  ".pi",
  "agent",
  "npm",
  "node_modules",
  "@injaneity",
  "pi-computer-use",
);

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("drives pi-computer-use through Electron, ACP, Pi, and the native helper", async ({}, testInfo) => {
  test.skip(
    !realE2eEnabled,
    "Set OPENMA_REAL_PI_COMPUTER_USE_E2E=1 to run the model- and macOS-dependent E2E",
  );
  test.skip(
    !(await pathExists(piAcpCommand)),
    `pi-acp is not installed at ${piAcpCommand}`,
  );
  test.skip(
    !(await pathExists(piComputerUsePackage)),
    "npm:@injaneity/pi-computer-use is not installed for Pi",
  );

  test.setTimeout(240_000);
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
      "Use the installed pi-computer-use extension now. Call find_roots with no arguments. " +
      "After it succeeds, reply with exactly PI_COMPUTER_USE_E2E_OK.",
    );
    await composer.press("Enter");

    await expect(
      launched.page.getByText("find_roots", { exact: true }),
    ).toBeVisible({ timeout: 180_000 });
    await expect(
      launched.page.getByText("PI_COMPUTER_USE_E2E_OK", { exact: true }),
    ).toBeVisible({ timeout: 180_000 });

    await testInfo.attach("Pi computer use real E2E", {
      body: await launched.page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await launched.cleanup();
  }
});
