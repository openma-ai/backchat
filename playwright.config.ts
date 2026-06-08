import { defineConfig } from "@playwright/test";

/**
 * Playwright runs against a real Electron build. Each test launches a
 * fresh ElectronApplication via test/helpers, so we don't need a
 * webServer block — Playwright's `_electron` API spawns the binary.
 *
 * BACKCHAT_TEST_HOOKS=1 is set per-spawn so main registers the test
 * IPC channels (see src/main/ipc.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // electron app per test — keep them serial
  reporter: process.env["CI"] ? "github" : "list",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
});
