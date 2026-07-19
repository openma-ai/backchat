import { expect, test } from "@playwright/test";
import { access, cp, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  launchAppWithHome,
  reloadRenderer,
  waitForRunnableHarness,
} from "./helpers";

const realE2eEnabled = process.env["OPENMA_REAL_CODEX_PLUGIN_E2E"] === "1";
const codexAcpCommand = join(homedir(), ".openma", "acp", "bin", "codex-acp");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function localInlinePreferencePlugin(): Promise<string | null> {
  const cache = join(
    homedir(),
    ".codex",
    "plugins",
    "cache",
    "personal",
    "inline-preference-app",
  );
  try {
    const versions = (await readdir(cache, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    return versions[0] ? join(cache, versions[0]) : null;
  } catch {
    return null;
  }
}

test("calls a Codex plugin tool through Electron and real codex-acp", async ({}, testInfo) => {
  test.skip(
    !realE2eEnabled,
    "Set OPENMA_REAL_CODEX_PLUGIN_E2E=1 to run the model-dependent Codex E2E",
  );
  test.skip(
    !(await pathExists(codexAcpCommand)),
    `codex-acp is not installed at ${codexAcpCommand}`,
  );
  const pluginSource = await localInlinePreferencePlugin();
  test.skip(
    !pluginSource,
    "The locally bound inline-preference-app plugin is not installed",
  );

  test.setTimeout(240_000);
  const home = testInfo.outputPath("home");
  await mkdir(home, { recursive: true });
  await cp(
    pluginSource!,
    join(home, "plugins", "inline-preference-app"),
    { recursive: true },
  );

  const launched = await launchAppWithHome(home, { language: "en" });
  try {
    await launched.page.evaluate(
      async ({ codexAcpCommand }) => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          default: {
            ...current.default,
            permission_mode: "ask",
            prompt_queue_enabled: true,
          },
          agents: [{
            id: "codex-acp",
            enabled: true,
            command_override: codexAcpCommand,
            args_override: [],
            env: [],
          }],
        });
      },
      { codexAcpCommand },
    );
    await reloadRenderer(launched.page);
    await waitForRunnableHarness(launched.page);

    const composer = launched.page.locator("textarea").first();
    await composer.fill(
      "Call the inline-preference-app MCP tool open_preference_picker now. " +
      "Use topic software, format bullets, and detail 2. Do not use another tool. " +
      "After the tool succeeds, reply with exactly CODEX_PLUGIN_E2E_OK.",
    );
    await composer.press("Enter");

    // The real codex-acp adapter currently omits the tool's MCP Apps
    // ui.resourceUri metadata. Assert the completed tool call itself here;
    // the deterministic adapter-compatibility E2E separately verifies that
    // OpenMA renders the iframe when ACP preserves the standard metadata.
    const completedCall = launched.page.getByRole("button", {
      name: /^(Ran|已运行)\s+mcp\.inline-preference-app\.open_preference_picker/,
    });
    await expect(completedCall).toBeVisible({ timeout: 180_000 });

    await testInfo.attach("Codex plugin tool real E2E", {
      body: await launched.page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await launched.cleanup();
  }
});
