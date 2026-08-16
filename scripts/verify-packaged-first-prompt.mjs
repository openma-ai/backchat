import { _electron as electron } from "@playwright/test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const appExecutable = resolve(
  process.argv[2]
    ?? "release/0.0.1/mac-arm64/Backchat.app/Contents/MacOS/Backchat",
);
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const fakeAgent = join(repoRoot, "e2e", "fixtures", "fake-acp-agent.mjs");
const home = await mkdtemp(join(tmpdir(), "backchat-packaged-e2e-"));
const omaRoot = join(home, ".oma");
const agent = join(omaRoot, "acp", "registry", "fake-acp", "agent");
const shimPath = join(omaRoot, "acp", "bin", "codex-acp");
const unsupportedRoot = join(home, `.${"openma"}`);
const unsupportedMarker = join(unsupportedRoot, "unsupported-marker.txt");
const screenshotPath = join(repoRoot, "test-results", "packaged-first-prompt.png");

await mkdir(dirname(agent), { recursive: true });
await mkdir(dirname(shimPath), { recursive: true });
await mkdir(unsupportedRoot, { recursive: true });
await writeFile(unsupportedMarker, "leave-me-alone\n");
await writeFile(
  agent,
  [
    "#!/bin/sh",
    "set -eu",
    `exec '${process.execPath}' '${fakeAgent}' "$@"`,
    "",
  ].join("\n"),
);
await chmod(agent, 0o755);
await writeFile(
  shimPath,
  [
    "#!/bin/sh",
    "set -eu",
    `exec '${agent}' "$@"`,
    "",
  ].join("\n"),
);
await chmod(shimPath, 0o755);

const app = await electron.launch({
  executablePath: appExecutable,
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    BACKCHAT_TEST_HOOKS: "1",
    BACKCHAT_E2E_SKIP_AGENT_WARMUP: "1",
    NODE_ENV: "test",
  },
});

try {
  const page = await app.firstWindow();
  try {
    await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });

  const shim = await readFile(shimPath, "utf8");
  if (!shim.includes(join(home, ".oma", "acp"))) {
    throw new Error(`Packaged app changed the managed ACP shim unexpectedly:\n${shim}`);
  }
  const marker = await readFile(unsupportedMarker, "utf8");
  if (marker !== "leave-me-alone\n") {
    throw new Error("Packaged app touched an unsupported storage root");
  }

  await page.evaluate(async (command) => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      default: {
        ...current.default,
        agent_id: "codex-acp",
        permission_mode: "ask",
        prompt_queue_enabled: true,
      },
      agents: [
        ...current.agents.filter((agent) => agent.id !== "codex-acp"),
        {
          id: "codex-acp",
          enabled: true,
          command_override: command,
          env: [],
        },
      ],
    });
  }, shimPath);
  await page.reload();
  await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
  await page.getByTestId("new-chat-button").click();

  // The first prompt is submitted from NewChatPage before a persisted chat
  // surface exists. Session pages gain data-chat-surface only after submit.
  const composer = page.locator('[data-page="new-chat"] textarea').last();
  await composer.fill("packaged-first-prompt-e2e");
  await composer.press("Enter");
  await page
    .getByText(
      "Fake response saved for packaged-first-prompt-e2e.",
      { exact: true },
    )
    .waitFor({ timeout: 20_000 });
  if (await page.getByText(/EPIPE/i).count()) {
    throw new Error("Packaged first prompt still surfaced EPIPE");
  }

  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  process.stdout.write(`${JSON.stringify({
    appExecutable,
    managedShim: shimPath,
    unsupportedStorageRoot: "ignored",
    firstPrompt: "passed",
    screenshotPath,
  }, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(screenshotPath), { recursive: true }).catch(() => undefined);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    throw error;
  }
} finally {
  await app.close().catch(() => undefined);
  await rm(home, { recursive: true, force: true });
}
