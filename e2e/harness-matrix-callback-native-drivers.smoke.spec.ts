import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession } from "./helpers";
import { harnessMatrixCallbackNativeDrivers } from "./harness-matrix-callback-native-drivers";

const cwd = "/Users/xiaoyang/Proj/backchat";

test("callback/native matrix drivers resolve visible GUI targets", async ({ app, page, bridge }) => {
  test.setTimeout(180_000);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 960));
  await page.setViewportSize({ width: 1440, height: 900 });
  await enableAgent(page, "claude-acp");
  await enableAgent(page, "codex-acp");
  await enableAgent(page, "cursor");
  await enableAgent(page, "pi-acp");
  await enableAgent(page, "opencode");
  await enableAgent(page, "kilo");
  await enableAgent(page, "kimi");

  const selections = [
    ...harnessMatrixCallbackNativeDrivers.map((driver) => ({
      driver,
      harness: { id: "claude-acp", label: "Claude", version: "0.64.2" },
    })),
    ...harnessMatrixCallbackNativeDrivers
      .filter((driver) => driver.id.startsWith("agent.native"))
      .map((driver) => ({
        driver,
        harness: { id: "codex-acp", label: "Codex", version: "1.1.9" },
      })),
    ...harnessMatrixCallbackNativeDrivers
      .filter((driver) => driver.id.startsWith("agent.native"))
      .flatMap((driver) => [
        {
          driver,
          harness: { id: "cursor", label: "Cursor", version: "2026.07.23" },
        },
        {
          driver,
          harness: { id: "pi-acp", label: "Pi", version: "0.0.33" },
        },
        {
          driver,
          harness: { id: "opencode", label: "OpenCode", version: "1.18.12" },
        },
        {
          driver,
          harness: { id: "kilo", label: "Kilo", version: "7.4.19" },
        },
      ]),
    ...harnessMatrixCallbackNativeDrivers
      .filter((driver) => driver.id.startsWith("agent.native"))
      .map((driver) => ({
        driver,
        harness: { id: "kimi", label: "Kimi Code", version: "0.33.0" },
      })),
  ];

  const selected = process.env.SMOKE_DRIVER
    ? selections.filter(({ driver }) => driver.id === process.env.SMOKE_DRIVER)
    : selections;
  for (const [index, { driver, harness }] of selected.entries()) {
    const sessionId = `d${String(index).padStart(2, "0")}-${harness.id}-driver-smoke`;
    const turnId = `turn-${sessionId}`;
    await injectSession(page, { sessionId, agentId: harness.id, cwd });
    const result = await driver.run({
      page,
      bridge,
      harness,
      sessionId,
      turnId,
      cwd,
      injectEvent: (event) => injectEvent(page, event as { type: string; [key: string]: unknown }),
      injectSession: async () => undefined,
    });
    await expect(result.target, `${harness.label} ${driver.id}: ${result.selector}`).toBeVisible();
  }
});
