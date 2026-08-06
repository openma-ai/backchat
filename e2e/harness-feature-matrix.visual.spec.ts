import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures";
import { injectEvent, injectSession, reloadRenderer } from "./helpers";
import type {
  MatrixFeatureDriver,
  MatrixHarness,
} from "./harness-matrix-driver-types";
import { SESSION_INPUT_MATRIX_DRIVERS } from "./harness-matrix-session-input-drivers";
import { OUTPUT_STATUS_MATRIX_DRIVERS } from "./harness-matrix-output-status-drivers";
import { CALLBACK_NATIVE_MATRIX_DRIVERS } from "./harness-matrix-callback-native-drivers";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repoRoot, "artifacts/harness-feature-matrix-staging");
const replayScreenshotsRoot = resolve(outputRoot, "screenshots/matrix");
const fakeAcpAgentPath = resolve(repoRoot, "e2e/fixtures/fake-acp-agent.mjs");

const HARNESSES: MatrixHarness[] = [
  { id: "claude-acp", label: "Claude", version: "0.64.2" },
  { id: "codex-acp", label: "Codex", version: "1.1.9" },
  { id: "cursor", label: "Cursor", version: "2026.07.23" },
  { id: "pi-acp", label: "Pi", version: "0.0.33" },
  { id: "opencode", label: "OpenCode", version: "1.18.12" },
  { id: "kilo", label: "Kilo", version: "7.4.19" },
  { id: "kimi", label: "Kimi Code", version: "0.33.0" },
];

const FEATURES = [
  "session.initialize-ready",
  "session.new-workspace",
  "session.load-history",
  "session.resume",
  "session.fork-side-chat",
  "session.side-chat-promote",
  "session.close-terminated",
  "session.local-archive-delete",
  "session.restart-replay",
  "input.prompt-text",
  "input.image-attachment",
  "input.resource-context",
  "input.session-reference",
  "input.available-commands",
  "input.mode",
  "input.config-model-reasoning",
  "input.cancel-stop",
  "input.steering",
  "input.queue",
  "output.streaming-response",
  "output.final-response",
  "output.thinking-reasoning",
  "output.notice-warning-error",
  "output.tool-start-input",
  "output.tool-progress-output",
  "output.tool-terminal",
  "output.plan-document",
  "output.task-list-progress",
  "output.usage-parent",
  "output.session-status-goal-queue",
  "callback.permission",
  "callback.filesystem",
  "callback.terminal",
  "callback.elicitation-form",
  "callback.elicitation-url",
  "callback.mcp-extension",
  "runtime.foreground-terminal",
  "runtime.background-work",
  "runtime.claude-monitor",
  "runtime.resources",
  "agent.native-list-lifecycle",
  "agent.native-detail",
  "agent.native-transcript",
  "agent.native-final",
  "runtime.vendor-raw",
] as const;

const LIVE_EVIDENCE_FILES: Record<string, string> = {
  "claude-acp": "claude-acp-final-response.json",
  "codex-acp": "codex-acp-final-response.json",
  cursor: "cursor-final-response.json",
  "pi-acp": "pi-acp-final-response.json",
  opencode: "opencode-final-response.json",
  kilo: "kilo-final-response.json",
  kimi: "kimi-final-response.json",
};

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function providerForHarness(harness: MatrixHarness): string {
  if (harness.id === "codex-acp") return "Codex default";
  if (harness.id === "cursor") return "Cursor account default";
  return "DeepSeek Anthropic";
}

function modelForHarness(harness: MatrixHarness): string {
  return harness.id === "codex-acp" || harness.id === "cursor"
    ? "runtime-default"
    : "deepseek-v4-flash";
}

test("captures all 45 GUI features × all 7 harnesses with real visible targets", async ({
  page,
  bridge,
}) => {
  test.setTimeout(25 * 60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await rm(replayScreenshotsRoot, { recursive: true, force: true });
  await mkdir(replayScreenshotsRoot, { recursive: true });

  await bridge.setAgentSetupFixture({
    agents: HARNESSES.map((harness) => ({
      id: harness.id,
      label: harness.label,
      command: harness.id,
      detected: true,
      available: true,
      installed: true,
      installedVersion: harness.version,
      auth: { status: "configured", message: "Available for GUI replay acceptance." },
    })),
  });
  await page.evaluate(async ({ harnesses, nodePath, fakeAgentPath }) => {
    const current = await window.backchat.settingsGet();
    const ids = new Set(harnesses.map((harness) => harness.id));
    await window.backchat.settingsPatch({
      agents: [
        ...current.agents.filter((agent) => !ids.has(agent.id)),
        ...harnesses.map((harness) => ({
          id: harness.id,
          enabled: true,
          // Replay acceptance exercises captured/versioned events against the
          // real GUI. Never let a synthetic session id auto-resume a paid or
          // stateful installed harness; live final-response coverage runs in
          // its own explicit spec.
          command_override: nodePath,
          args_override: [fakeAgentPath],
          env: [
            { name: "BACKCHAT_FAKE_AGENT_NAME", value: harness.label },
            { name: "BACKCHAT_FAKE_AGENT_TITLE", value: harness.label },
            { name: "BACKCHAT_FAKE_AGENT_VERSION", value: harness.version },
          ],
        })),
      ],
    });
  }, {
    harnesses: HARNESSES,
    nodePath: process.execPath,
    fakeAgentPath: fakeAcpAgentPath,
  });
  await reloadRenderer(page);

  const allDrivers = [
    ...SESSION_INPUT_MATRIX_DRIVERS,
    ...OUTPUT_STATUS_MATRIX_DRIVERS,
    ...CALLBACK_NATIVE_MATRIX_DRIVERS,
  ];
  const driverById = new Map(allDrivers.map((driver) => [driver.id, driver]));
  expect(driverById.size).toBe(44);
  expect(allDrivers).toHaveLength(44);
  expect(driverById.has("output.final-response")).toBe(false);
  for (const feature of FEATURES) {
    if (feature !== "output.final-response") {
      expect(driverById.has(feature), `missing matrix driver for ${feature}`).toBe(true);
    }
  }

  const cells: Array<Record<string, unknown>> = [];
  for (const [harnessIndex, harness] of HARNESSES.entries()) {
    for (const [featureIndex, feature] of FEATURES.entries()) {
      if (feature === "output.final-response") {
        const evidenceFile = LIVE_EVIDENCE_FILES[harness.id];
        const evidence = JSON.parse(await readFile(
          resolve(outputRoot, "live-gui", evidenceFile),
          "utf8",
        )) as Record<string, unknown>;
        expect(evidence.feature).toBe(feature);
        expect(evidence.harness).toBe(harness.label);
        cells.push(evidence);
        continue;
      }

      const driver = driverById.get(feature) as MatrixFeatureDriver;
      // Some feature drivers intentionally navigate into Settings (for
      // example local archive/delete). Restore the chat workspace before the
      // next cell so every driver starts from the same visible application
      // surface instead of inheriting the preceding cell's route.
      const backToApp = page
        .getByRole("button", { name: /^(Back to app|返回应用)$/ })
        .or(page.getByRole("link", { name: /^(Back to app|返回应用)$/ }))
        .first();
      if (await backToApp.isVisible()) {
        await backToApp.click();
      }
      // injectSession opens a sidebar row using the first six id characters;
      // keep that prefix unique per matrix cell so later cells cannot reopen
      // an earlier session with the same harness.
      const sessionId = `m${harnessIndex}-${String(featureIndex + 1).padStart(2, "0")}-${safeSlug(harness.id)}`;
      const turnId = `turn-${sessionId}`;
      const harnessSlug = safeSlug(harness.label);
      const cwd = `/tmp/backchat-matrix/${harnessSlug}/${harnessSlug}-${String(featureIndex + 1).padStart(2, "0")}-${safeSlug(feature)}`;
      // Terminal and filesystem callbacks require a real workspace path;
      // session-row fixtures alone do not create it on disk.
      await mkdir(cwd, { recursive: true });
      await injectSession(page, { sessionId, agentId: harness.id, cwd });

      const injectReady = async (input: {
        supportsSessionFork?: boolean;
        supportsSessionResume?: boolean;
        supportsSessionClose?: boolean;
        configOptions?: unknown[];
      } = {}) => injectEvent(page, {
        type: "session.ready",
        session_id: sessionId,
        acp_session_id: `acp-${sessionId}`,
        agent_id: harness.id,
        cwd,
        protocol_version: 1,
        agent_info: { name: harness.label, version: harness.version },
        agent_capabilities: {
          loadSession: true,
          promptCapabilities: { image: true, embeddedContext: true },
          mcpCapabilities: { http: true, sse: true },
        },
        supports_session_fork: input.supportsSessionFork ?? true,
        supports_session_resume: input.supportsSessionResume ?? true,
        supports_session_close: input.supportsSessionClose ?? true,
        config_options: input.configOptions,
      });
      await injectReady();

      const runStartedAt = new Date();
      const runStartedMs = Date.now();
      const result = await driver.run({
        page,
        bridge,
        harness,
        sessionId,
        turnId,
        cwd,
        injectEvent: (event) => {
          if (typeof event.type === "string") {
            return injectEvent(page, event as { type: string; [key: string]: unknown });
          }
          return injectEvent(page, {
            type: "session.event",
            session_id: sessionId,
            turn_id: turnId,
            event,
          });
        },
        injectSession: injectReady,
      });
      const durationMs = Date.now() - runStartedMs;
      let targetBox: Awaited<ReturnType<typeof result.target.boundingBox>> = null;
      // Session status updates can replace a capability row between the
      // visibility assertion and the scroll action. A Locator re-resolves its
      // selector, but an in-flight action can still observe the old DOM node.
      // Retry the complete visible -> scroll -> measure transaction so the
      // screenshot gate proves one stable, current product node instead of
      // accepting a detached handle or weakening the viewport assertion.
      await expect(async () => {
        await expect(
          result.target,
          `${feature} × ${harness.label} target`,
        ).toBeVisible({ timeout: 3_000 });
        await result.target.scrollIntoViewIfNeeded({ timeout: 3_000 });
        targetBox = await result.target.boundingBox();
        expect(targetBox, `${feature} × ${harness.label} target box`).not.toBeNull();
      }).toPass({
        timeout: 15_000,
        intervals: [50, 100, 250, 500],
      });
      expect(targetBox, `${feature} × ${harness.label} target box`).not.toBeNull();
      // Chromium can report a fully visible scrolled element at a tiny
      // negative fractional coordinate (for example -0.034 CSS px). Keep a
      // sub-pixel-only tolerance; anything clipped by half a CSS pixel or
      // more still fails the screenshot gate.
      const viewportEpsilon = 0.5;
      expect(targetBox!.x).toBeGreaterThanOrEqual(-viewportEpsilon);
      expect(targetBox!.y).toBeGreaterThanOrEqual(-viewportEpsilon);
      expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(1440 + viewportEpsilon);
      expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(900 + viewportEpsilon);
      expect(result.observed.trim()).not.toBe("");

      const filename = `${String(featureIndex + 1).padStart(2, "0")}-${safeSlug(feature)}--${safeSlug(harness.label)}.png`;
      const screenshotPath = resolve(replayScreenshotsRoot, filename);
      await page.screenshot({ path: screenshotPath });
      cells.push({
        feature,
        harness: harness.label,
        harnessVersion: harness.version,
        status: result.status ?? "pass-replay",
        verificationMode: result.verificationMode ?? "replay",
        trigger: result.trigger,
        provider: providerForHarness(harness),
        model: modelForHarness(harness),
        runAt: runStartedAt.toISOString(),
        durationMs,
        protocolBasis: "ACP v1 plus Backchat canonical event and visible Electron GUI projection",
        screenshot: relative(outputRoot, screenshotPath),
        assertion: {
          selector: result.selector,
          expected: result.expected,
          observed: result.observed,
          result: "passed",
          targetVisible: true,
          withinScreenshot: true,
        },
        evidence: result.evidence ?? [],
      });

      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }

  expect(cells).toHaveLength(315);
  expect(new Set(cells.map((cell) => `${cell.feature}\u0000${cell.harness}`)).size).toBe(315);
  expect(new Set(cells.map((cell) => cell.screenshot)).size).toBe(315);
  await writeFile(
    resolve(outputRoot, "manifest.json"),
    JSON.stringify({
      title: "Backchat GUI Feature × Harness 严格验收报告",
      generatedAt: new Date().toISOString(),
      source: "docs/harness-gui-acceptance-standard.md",
      features: FEATURES,
      harnesses: HARNESSES.map((harness) => harness.label),
      routing: [
        { harness: "Claude", provider: "DeepSeek Anthropic", status: "PASS-LIVE", detail: "claude-agent-acp 0.64.2; deepseek-v4-flash" },
        { harness: "Codex", provider: "Codex default", status: "PASS-LIVE", detail: "codex-acp 1.1.9; excluded from DeepSeek as requested" },
        { harness: "Cursor", provider: "Cursor account default", status: "PASS-LIVE", detail: "official Cursor 2026.07.23 account session; runtime-default" },
        { harness: "Pi", provider: "DeepSeek Anthropic", status: "PASS-LIVE", detail: "pi-acp 0.0.33 with Pi 0.83.0; deepseek-v4-flash" },
        { harness: "OpenCode", provider: "DeepSeek Anthropic", status: "PASS-LIVE", detail: "OpenCode 1.18.12; deepseek-v4-flash" },
        { harness: "Kilo", provider: "DeepSeek Anthropic", status: "PASS-LIVE", detail: "Kilo 7.4.19; deepseek-v4-flash" },
        { harness: "Kimi Code", provider: "DeepSeek Anthropic", status: "PASS-LIVE", detail: "@moonshot-ai/kimi-code 0.33.0 via kimi acp; deepseek-v4-flash" },
      ],
      notes: [
        "PASS-LIVE is reserved for the separately executed real Electron final-response run.",
        "PASS-REPLAY means a versioned/synthetic ACP event was projected through the real Electron renderer and asserted against a visible GUI locator.",
        "No evidence overlay is added to screenshots; every assertion target belongs to the product UI.",
        "Cursor uses its official signed-in account/default provider because its ACP entrypoint does not advertise an Anthropic-compatible provider override.",
      ],
      cells,
    }, null, 2),
    "utf8",
  );
});
