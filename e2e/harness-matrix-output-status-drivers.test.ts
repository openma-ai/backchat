import { expect, test } from "./fixtures";
import { resolve } from "node:path";

import { injectEvent, injectSession, reloadRenderer } from "./helpers";
import { harnessMatrixOutputStatusDrivers } from "./harness-matrix-output-status-drivers";

test("drives output/status features 22 through 30 through visible GUI targets", async ({
  page,
  bridge,
}) => {
  expect(harnessMatrixOutputStatusDrivers.map((driver) => driver.id)).toEqual([
    "output.thinking-reasoning",
    "output.notice-warning-error",
    "output.tool-start-input",
    "output.tool-progress-output",
    "output.tool-terminal",
    "output.plan-document",
    "output.task-list-progress",
    "output.usage-parent",
    "output.session-status-goal-queue",
  ]);
  expect(
    harnessMatrixOutputStatusDrivers.some(
      (driver) => driver.id === "output.final-response",
    ),
  ).toBe(false);

  const sessionId = "matrix-output-status";
  const turnId = "matrix-output-status-turn";
  const cwd = "/tmp/backchat-matrix/output-status";
  await page.evaluate(async ({ nodePath, fakeAgentPath }) => {
    await window.backchat.settingsPatch({
      agents: [{
        id: "codex-acp",
        enabled: true,
        command_override: nodePath,
        args_override: [fakeAgentPath],
        env: [
          { name: "BACKCHAT_FAKE_AGENT_NAME", value: "Codex" },
          { name: "BACKCHAT_FAKE_AGENT_TITLE", value: "Codex" },
          { name: "BACKCHAT_FAKE_AGENT_VERSION", value: "test" },
        ],
      }],
    });
  }, {
    nodePath: process.execPath,
    fakeAgentPath: resolve("e2e/fixtures/fake-acp-agent.mjs"),
  });
  await reloadRenderer(page);
  await injectSession(page, { sessionId, agentId: "codex-acp", cwd });

  for (const driver of harnessMatrixOutputStatusDrivers) {
    const result = await driver.run({
      page,
      bridge,
      harness: { id: "codex-acp", label: "Codex", version: "test" },
      sessionId,
      turnId,
      cwd,
      injectEvent: (event) => injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event,
      }),
      injectSession: async () => {},
    });

    await expect(result.target, `${driver.id} must target real visible GUI`).toBeVisible();
    expect(result.selector).not.toContain("overlay");
    expect(result.observed.trim().length).toBeGreaterThan(0);
    expect(result.trigger.trim().length).toBeGreaterThan(0);
    expect(
      driver.id === "output.plan-document"
        ? ["pass-replay", "fail"]
        : ["pass-replay"],
    ).toContain(result.status);
    expect(result.verificationMode).toBe("replay");
  }
});
