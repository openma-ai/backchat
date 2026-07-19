import { expect, test } from "@playwright/test";
import { cp, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  launchAppWithHome,
  reloadRenderer,
  waitForRunnableHarness,
} from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const fakeAcpAgentPath = join(here, "fixtures", "fake-acp-agent.mjs");

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

test("runs a locally bound Codex MCP App plugin through a real ACP session", async ({}, testInfo) => {
  const pluginSource = await localInlinePreferencePlugin();
  test.skip(!pluginSource, "The locally bound inline-preference-app plugin is not installed");

  const home = testInfo.outputPath("home");
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  await cp(
    pluginSource!,
    join(home, "plugins", "inline-preference-app"),
    { recursive: true },
  );

  const launched = await launchAppWithHome(home, { language: "en" });
  try {
    const consoleErrors: string[] = [];
    launched.page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await launched.page.evaluate(
      async ({ nodePath, fakeAcpAgentPath, workspace }) => {
        await window.backchat.settingsPatch({
          default: {
            agent_id: "codex-acp",
            workspace_path: workspace,
            permission_mode: "ask",
            prompt_queue_enabled: true,
          },
          agents: [{
            id: "codex-acp",
            enabled: true,
            command_override: nodePath,
            args_override: [fakeAcpAgentPath],
            env: [],
          }],
        });
      },
      { nodePath: process.execPath, fakeAcpAgentPath, workspace },
    );
    await reloadRenderer(launched.page);
    await waitForRunnableHarness(launched.page);

    const composer = launched.page.locator("textarea").first();
    await composer.fill("open-inline-preference-plugin-e2e");
    await composer.press("Enter");

    const app = launched.page.getByRole("region", { name: "打开偏好选择器" });
    await expect(app).toBeVisible({ timeout: 15_000 });
    const frame = launched.page.frameLocator('iframe[title="打开偏好选择器"]');
    await expect(frame.getByRole("heading", { name: "选择输出偏好" })).toBeVisible();
    await frame.getByRole("button", { name: "保存到 MCP Server" }).click();
    await expect(frame.locator("#status")).toHaveText("已保存", {
      timeout: 10_000,
    }).catch((error) => {
      throw new Error(`${String(error)}\nConsole errors:\n${consoleErrors.join("\n")}`);
    });

    await testInfo.attach("Codex plugin MCP App E2E", {
      body: await launched.page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    await launched.cleanup();
  }
});
