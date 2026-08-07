import { expect, test } from "./fixtures";

import { enableAgent, injectEvent, injectSession } from "./helpers";

test.describe("composer configuration", () => {
  test("runtime and agent pickers are compact nested menus", async ({ page, bridge }) => {
    await bridge.setAgentSetupFixture({
      agents: [
        {
          id: "claude-acp",
          label: "Claude",
          command: "claude-acp",
          detected: true,
          available: true,
          installed: true,
        },
        {
          id: "codex-acp",
          label: "Codex",
          command: "codex-acp",
          detected: true,
          available: true,
          installed: true,
        },
      ],
    });
    await enableAgent(page, "claude-acp");
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "claude-acp" });
    const longModelName = "deepseek-anthropic/DeepSeek V4 Flash";
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-config-layout",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "deepseek-v4-flash",
            options: [
              { value: "deepseek-v4-flash", name: longModelName },
            ],
          },
          {
            id: "fast",
            name: "Fast mode",
            category: "model_config",
            type: "boolean",
            currentValue: false,
          },
        ],
      },
    });

    const runPicker = page.getByRole("button", {
      name: /Run on Local with .* using/,
    });
    const modelSummary = runPicker.getByText(longModelName, { exact: true });
    await expect(modelSummary).toHaveCSS("text-overflow", "ellipsis");
    await modelSummary.hover();
    await expect(page.getByRole("tooltip")).toHaveText(longModelName);

    const runtimeIcon = runPicker.getByLabel("Local", { exact: true });
    await runtimeIcon.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Local");

    await expect(
      page.getByRole("button", { name: "Fast mode", exact: true }),
    ).toHaveCount(0);

    await runPicker.click();

    await expect(
      page.getByRole("menuitem", { name: "Fast Off", exact: true }),
    ).toBeVisible();

    const runtimePicker = page.getByRole("menuitem", {
      name: /^(Runtime|运行位置).*(Local|本机)$/,
    });
    await expect(runtimePicker).toHaveAttribute("aria-haspopup", "menu");
    await runtimePicker.hover();
    await expect(
      page.getByRole("menuitem", {
        name: /^(Local|本机).*(This machine|当前设备)$/,
      }),
    ).toBeVisible();
    const cloudRuntime = page.getByRole("menuitem", {
      name: /^(Cloud|云端).*(Coming soon|即将推出)$/,
    });
    await expect(cloudRuntime).toBeDisabled();
    await expect(cloudRuntime.locator("svg.lucide-cloud")).toBeVisible();
    const remoteRuntime = page.getByRole("menuitem", {
      name: /^(Other machine|其他设备).*(Not connected|未连接)$/,
    });
    await expect(remoteRuntime).toBeDisabled();
    await expect(remoteRuntime.locator("svg.lucide-server")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    const agentPicker = page.getByRole("menuitem", {
      name: /(Harness|智能体) Claude$/,
    });
    await expect(agentPicker).toHaveAttribute("aria-haspopup", "menu");
    await agentPicker.hover();
    await expect(
      page.getByRole("menuitem", { name: /Codex.*codex-acp/ }),
    ).toBeVisible();
  });

  test("model picker switches the active session config option", async ({ page, bridge }) => {
    await enableAgent(page, "claude-acp");
    const sessionId = await injectSession(page);
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-config-catalogue",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5-mini",
            options: [
              { value: "gpt-5-mini", name: "GPT-5 mini" },
              { value: "gpt-5", name: "GPT-5" },
            ],
          },
        ],
      },
    });

    const modelPicker = page.getByRole("button", {
      name: /Run on Local with .* using/,
    });
    await expect(modelPicker).toContainText("GPT-5 mini");

    await modelPicker.click();
    await page
      .getByRole("menuitem", { name: "Model GPT-5 mini", exact: true })
      .hover();
    // Radix briefly leaves the submenu under an animating portal layer after
    // hover. The item is already visible and enabled; force dispatch avoids
    // the transient root hit-test interception while preserving the real
    // menuitem click handler and session/set_config_option path.
    await page
      .getByRole("menuitem", { name: "GPT-5 Model" })
      .click({ force: true });

    await expect
      .poll(async () =>
        (await bridge.readSessionConfigOptions()).map((option) => ({
          config_id: option.config_id,
          value: option.value,
        })),
      )
      .toEqual([{ config_id: "model", value: "gpt-5" }]);
    await expect(modelPicker).toContainText("GPT-5");
  });
});
