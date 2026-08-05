import { _electron as electron } from "@playwright/test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const appExecutable = resolve(
  process.argv[2]
    ?? "release/0.0.1/mac-arm64/Backchat.app/Contents/MacOS/Backchat",
);
const home = await mkdtemp(join(tmpdir(), "backchat-real-first-prompt-"));
const omaRoot = join(home, ".oma");
const acpRoot = join(omaRoot, "acp");
const registryRoot = join(acpRoot, "registry", "codex-acp");
const realRegistryRoot = join(
  homedir(),
  ".oma",
  "acp",
  "registry",
  "codex-acp",
);
const realNpxRoot = join(realRegistryRoot, "npx");
const shimPath = join(acpRoot, "bin", "codex-acp");
const expectedCommand = join(
  registryRoot,
  "npx",
  "node_modules",
  ".bin",
  "codex-acp",
);
const screenshotPath = resolve(
  "test-results",
  "packaged-real-first-prompt.png",
);
const launchedAt = Date.now();

await mkdir(dirname(shimPath), { recursive: true });
await mkdir(registryRoot, { recursive: true });
await symlink(realNpxRoot, join(registryRoot, "npx"));
await writeFile(
  join(registryRoot, "install.json"),
  await readFile(join(realRegistryRoot, "install.json"), "utf8"),
);
await writeFile(
  shimPath,
  [
    "#!/bin/sh",
    "set -eu",
    "exec '/missing/acp/registry/codex-acp/npx/node_modules/.bin/codex-acp' \"$@\"",
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
    CODEX_HOME: join(homedir(), ".codex"),
    BACKCHAT_TEST_HOOKS: "1",
    BACKCHAT_E2E_SKIP_AGENT_WARMUP: "0",
    NODE_ENV: "test",
  },
});

try {
  const page = await app.firstWindow();
  await page.getByTestId("new-chat-button").waitFor({ timeout: 45_000 });
  const windowReadyMs = Date.now() - launchedAt;
  await page.evaluate(async () => {
    await window.backchat.agentsList();
  });
  const warmupReadyMs = Date.now() - launchedAt;
  await page.waitForFunction(
    async (command) => {
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
      return true;
    },
    shimPath,
  );
  await page.reload();
  await page.getByTestId("new-chat-button").waitFor({ timeout: 45_000 });
  await page.getByTestId("new-chat-button").click();

  const composer = page.locator('[data-chat-surface="main"] textarea').last();
  await composer.fill("Reply exactly PACKAGED_REAL_OK.");
  await composer.press("Enter");
  const outcome = await Promise.race([
    page
      .locator('[data-session-turn-response="true"]')
      .getByText(/PACKAGED_REAL_OK/)
      .last()
      .waitFor({ timeout: 120_000 })
      .then(() => "passed"),
    page
      .getByText(/ACP connection closed/i)
      .last()
      .waitFor({ timeout: 120_000 })
      .then(() => "closed"),
  ]);
  if (outcome === "closed") {
    throw new Error("Real packaged first prompt closed the ACP connection");
  }
  const firstPromptCompletedMs = Date.now() - launchedAt;

  const repairedShim = await readFile(shimPath, "utf8");
  if (!repairedShim.includes(expectedCommand)) {
    throw new Error(`Packaged app did not repair the managed shim:\n${repairedShim}`);
  }
  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  process.stdout.write(`${JSON.stringify({
    appExecutable,
    repairedShim: expectedCommand,
    firstPrompt: "passed",
    windowReadyMs,
    warmupReadyMs,
    firstPromptCompletedMs,
    screenshotPath,
  }, null, 2)}\n`);
} finally {
  await app.close().catch(() => undefined);
  await rm(home, { recursive: true, force: true });
}
