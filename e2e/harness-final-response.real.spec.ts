import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  launchApp,
  reloadRenderer,
  waitForRunnableHarness,
} from "./helpers";

const enabled = process.env["BACKCHAT_REAL_HARNESS_MATRIX_E2E"] === "1";
const secret = process.env["BACKCHAT_DEEPSEEK_TEST_KEY"];
const repoRoot = resolve(import.meta.dirname, "..");
const configRoot = resolve(repoRoot, "artifacts/harness-live-config");
const outputRoot = resolve(repoRoot, "artifacts/harness-feature-matrix-staging");
const screenshotRoot = resolve(outputRoot, "screenshots");
const evidenceRoot = resolve(outputRoot, "live-gui");

type HarnessCase = {
  id: string;
  label: string;
  version: string;
  command: string;
  model: string | null;
  env: (apiKey: string) => Record<string, string>;
};

const deepseekBaseUrl = "https://api.deepseek.com/anthropic";
const deepseekModel = "deepseek-v4-flash";
const managedBin = "/Users/xiaoyang/.oma/acp/bin";

const harnesses: HarnessCase[] = [
  {
    id: "claude-acp",
    label: "Claude",
    version: "0.64.2",
    command: `${managedBin}/claude-agent-acp`,
    model: deepseekModel,
    env: (apiKey) => ({
      ANTHROPIC_BASE_URL: deepseekBaseUrl,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: deepseekModel,
      ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_SONNET_MODEL: deepseekModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: deepseekModel,
      CLAUDE_CODE_SUBAGENT_MODEL: deepseekModel,
    }),
  },
  {
    id: "codex-acp",
    label: "Codex",
    version: "1.1.9",
    command: `${managedBin}/codex-acp`,
    model: "runtime-default",
    env: () => ({
      CODEX_PATH: "/opt/homebrew/bin/codex",
      INITIAL_AGENT_MODE: "agent",
    }),
  },
  {
    id: "pi-acp",
    label: "Pi",
    version: "0.0.33",
    command: `${managedBin}/openma-acp-pi-acp`,
    model: deepseekModel,
    env: (apiKey) => ({
      PI_CODING_AGENT_DIR: resolve(configRoot, "pi"),
      PI_ACP_PI_COMMAND: "/Users/xiaoyang/.oma/acp/runtime/pi/node_modules/.bin/pi",
      BACKCHAT_DEEPSEEK_API_KEY: apiKey,
    }),
  },
  {
    id: "opencode",
    label: "OpenCode",
    version: "1.18.12",
    command: `${managedBin}/openma-acp-opencode`,
    model: deepseekModel,
    env: (apiKey) => ({
      OPENCODE_CONFIG: resolve(configRoot, "opencode.json"),
      BACKCHAT_DEEPSEEK_API_KEY: apiKey,
    }),
  },
  {
    id: "kilo",
    label: "Kilo",
    version: "7.4.19",
    command: `${managedBin}/openma-acp-kilo`,
    model: deepseekModel,
    env: (apiKey) => ({
      KILO_CONFIG: resolve(configRoot, "kilo.json"),
      OPENCODE_CONFIG: resolve(configRoot, "kilo.json"),
      BACKCHAT_DEEPSEEK_API_KEY: apiKey,
    }),
  },
  {
    id: "kimi",
    label: "Kimi Code",
    version: "0.33.0",
    command: `${managedBin}/openma-acp-kimi`,
    model: deepseekModel,
    env: (apiKey) => ({
      KIMI_CODE_HOME: resolve(configRoot, "kimi-code-home"),
      KIMI_DISABLE_TELEMETRY: "1",
      KIMI_CODE_NO_AUTO_UPDATE: "1",
      KIMI_LOG_LEVEL: "warn",
      KIMI_MODEL_NAME: deepseekModel,
      KIMI_MODEL_DISPLAY_NAME: "DeepSeek V4 Flash",
      KIMI_MODEL_PROVIDER_TYPE: "anthropic",
      KIMI_MODEL_BASE_URL: deepseekBaseUrl,
      KIMI_MODEL_API_KEY: apiKey,
      KIMI_MODEL_MAX_CONTEXT_SIZE: "1000000",
      KIMI_MODEL_MAX_OUTPUT_SIZE: "384000",
      KIMI_MODEL_CAPABILITIES: "thinking",
    }),
  },
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function closeAuxiliaryPanels(page: Page): Promise<void> {
  let changed = false;
  const closeSidePanel = page.getByRole("button", {
    name: "Close side panel",
    exact: true,
  });
  if (await closeSidePanel.isVisible()) {
    await closeSidePanel.click();
    await expect(closeSidePanel).toHaveCount(0);
    changed = true;
  }
  const closeTerminal = page.getByRole("button", {
    name: "Close terminal panel",
    exact: true,
  });
  if (await closeTerminal.isVisible()) {
    await closeTerminal.click();
    await expect(closeTerminal).toHaveCount(0);
    changed = true;
  }
  // AppShell intentionally animates its rail and main-stage reservations for
  // 280 ms. Button removal proves state changed; this wait ensures screenshot
  // evidence is captured after the visual transition, not mid-collapse.
  if (changed) await page.waitForTimeout(350);
}

async function waitForExactAssistantAnswer(
  page: Page,
  marker: string,
): Promise<{
  response: ReturnType<Page["locator"]>;
  observed: string;
}> {
  const response = page.locator('[data-session-turn-response="true"]').last();
  const answers = response.locator('[data-session-turn-answer="true"]');
  await expect.poll(
    async () => (await answers.allInnerTexts()).join("").trim(),
    {
      timeout: 180_000,
      message: "the visible assistant answer, excluding thinking, must match exactly",
    },
  ).toBe(marker);
  return {
    response,
    observed: (await answers.allInnerTexts()).join("").trim(),
  };
}

// Keep each harness independent: one upstream/provider failure must not skip
// the remaining real GUI runs. CI still uses --workers=1 for deterministic
// desktop focus and filesystem isolation.
test.describe.configure({ mode: "default", timeout: 300_000 });

for (const harness of harnesses) {
  test(`renders a live final response from ${harness.label}`, async ({}, testInfo) => {
    test.skip(!enabled, "Set BACKCHAT_REAL_HARNESS_MATRIX_E2E=1 to run paid/live harness tests");
    test.skip(harness.id !== "codex-acp" && !secret, "DeepSeek API key is required");
    test.skip(!(await exists(harness.command)), `Harness not installed at ${harness.command}`);
    test.setTimeout(240_000);

    await mkdir(screenshotRoot, { recursive: true });
    await mkdir(evidenceRoot, { recursive: true });
    const launched = await launchApp({
      language: "en",
      env: harness.env(secret ?? ""),
    });
    const marker = `BACKCHAT_GUI_LIVE_OK_${harness.id.replaceAll("-", "_").toUpperCase()}`;
    const prompt = `Reply exactly ${marker} and nothing else.`;
    const screenshot = resolve(
      screenshotRoot,
      `21-output-final-response--${harness.id.replace(/-acp$/, "")}.png`,
    );
    try {
      await launched.page.setViewportSize({ width: 1440, height: 900 });
      await launched.page.evaluate(
        async ({ id, command }) => {
          const current = await window.backchat.settingsGet();
          await window.backchat.settingsPatch({
            default: {
              ...current.default,
              permission_mode: "ask",
              prompt_queue_enabled: true,
            },
            agents: [{
              id,
              enabled: true,
              command_override: command,
              args_override: [],
              env: [],
            }],
          });
        },
        { id: harness.id, command: harness.command },
      );
      await reloadRenderer(launched.page);
      await waitForRunnableHarness(launched.page);
      await closeAuxiliaryPanels(launched.page);
      const composer = launched.page.locator("textarea").first();
      await expect(composer).toBeVisible();
      await expect(composer).toBeEnabled();
      await composer.fill(prompt);
      const runStartedAt = new Date();
      const runStartedMs = Date.now();
      await composer.press("Enter");
      await expect(launched.page.getByText(prompt, { exact: true })).toBeVisible();
      const {
        response: finalResponse,
        observed: observedResponse,
      } = await waitForExactAssistantAnswer(launched.page, marker);
      await expect(launched.page.getByRole("button", { name: "Stop" })).toHaveCount(0, {
        timeout: 30_000,
      });
      // Some panels are spawned lazily with the first live session, so close
      // them after completion as well and assert the screenshot state.
      await closeAuxiliaryPanels(launched.page);
      const targetBox = await finalResponse.boundingBox();
      expect(targetBox).not.toBeNull();
      expect(targetBox!.x).toBeGreaterThanOrEqual(0);
      expect(targetBox!.y).toBeGreaterThanOrEqual(0);
      expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(1440);
      expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(900);
      await launched.page.screenshot({ path: screenshot });
      const durationMs = Date.now() - runStartedMs;
      await writeFile(
        resolve(evidenceRoot, `${harness.id}-final-response.json`),
        JSON.stringify({
          feature: "output.final-response",
          harness: harness.label,
          harnessVersion: harness.version,
          status: "pass-live",
          verificationMode: "live",
          trigger: prompt,
          provider: harness.id === "codex-acp" ? "Codex default" : "DeepSeek Anthropic",
          endpoint: harness.id === "codex-acp" ? null : deepseekBaseUrl,
          model: harness.model,
          runAt: runStartedAt.toISOString(),
          durationMs,
          protocolBasis: "ACP v1 session/prompt and session/update final agent message",
          screenshot: `screenshots/${screenshot.split("/").at(-1)}`,
          assertion: {
            selector: `[data-session-turn-response="true"]:last [data-session-turn-answer="true"]`,
            expected: `Visible assistant answer equals ${marker}; thinking is excluded`,
            observed: observedResponse,
            result: "passed",
            targetVisible: true,
            withinScreenshot: true,
          },
        }, null, 2),
        "utf8",
      );
    } finally {
      await launched.cleanup();
    }
  });
}

test("renders a live final response from Cursor with the official signed-in account", async () => {
  test.skip(!enabled, "Set BACKCHAT_REAL_HARNESS_MATRIX_E2E=1 to run paid/live harness tests");
  const command = `${managedBin}/openma-acp-cursor`;
  test.skip(!(await exists(command)), `Cursor harness not installed at ${command}`);
  test.setTimeout(240_000);

  await mkdir(screenshotRoot, { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
  // Cursor uses its own official account session/default provider. It does not
  // advertise an Anthropic-compatible provider override, so DeepSeek is not
  // injected into this harness.
  const launched = await launchApp({
    language: "en",
    env: { AGENT_CLI_CREDENTIAL_STORE: "file" },
  });
  const screenshot = resolve(screenshotRoot, "21-output-final-response--cursor.png");
  const marker = "BACKCHAT_GUI_LIVE_OK_CURSOR";
  const prompt = `Reply exactly ${marker} and nothing else.`;
  try {
    await launched.page.setViewportSize({ width: 1440, height: 900 });
    await launched.page.evaluate(async ({ command }) => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        agents: [{
            id: "cursor",
            enabled: true,
            command_override: command,
            // The managed shim already invokes `cursor-agent acp`; the ACP
            // subcommand has no --model option in the installed CLI.
            args_override: [],
          env: [],
        }],
      });
    }, { command });
    await reloadRenderer(launched.page);
    await waitForRunnableHarness(launched.page);
    await closeAuxiliaryPanels(launched.page);
    const composer = launched.page.locator("textarea").first();
    await expect(composer).toBeVisible();
    await expect(composer).toBeEnabled();
    await composer.fill(prompt);
    const runStartedAt = new Date();
    const runStartedMs = Date.now();
    await composer.press("Enter");
    await expect(launched.page.getByText(prompt, { exact: true })).toBeVisible();
    const {
      response: finalResponse,
      observed: observedResponse,
    } = await waitForExactAssistantAnswer(launched.page, marker);
    await expect(launched.page.getByRole("button", { name: "Stop" })).toHaveCount(0, {
      timeout: 30_000,
    });
    await closeAuxiliaryPanels(launched.page);
    const targetBox = await finalResponse.boundingBox();
    expect(targetBox).not.toBeNull();
    expect(targetBox!.x).toBeGreaterThanOrEqual(0);
    expect(targetBox!.y).toBeGreaterThanOrEqual(0);
    expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(1440);
    expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(900);
    await launched.page.screenshot({ path: screenshot });
    const durationMs = Date.now() - runStartedMs;
    await writeFile(
      resolve(evidenceRoot, "cursor-final-response.json"),
      JSON.stringify({
        feature: "output.final-response",
        harness: "Cursor",
        harnessVersion: "2026.07.23",
        status: "pass-live",
        verificationMode: "live",
        trigger: prompt,
        provider: "Cursor account default",
        endpoint: null,
        model: "runtime-default",
        runAt: runStartedAt.toISOString(),
        durationMs,
        protocolBasis: "ACP v1 session/prompt and session/update final agent message",
        screenshot: "screenshots/21-output-final-response--cursor.png",
        assertion: {
          selector: `[data-session-turn-response="true"]:last [data-session-turn-answer="true"]`,
          expected: `Visible assistant answer equals ${marker}; thinking is excluded`,
          observed: observedResponse,
          result: "passed",
          targetVisible: true,
          withinScreenshot: true,
        },
      }, null, 2),
      "utf8",
    );
  } finally {
    await launched.cleanup();
  }
});
