import { expect, test } from "./fixtures";

import { enableAgent, injectEvent, injectSession } from "./helpers";

test.describe("composer configuration", () => {
  test("agent and config pickers are compact nested menus", async ({ page, bridge }) => {
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

    await expect(
      page.getByRole("button", { name: "Fast mode", exact: true }),
    ).toHaveCount(0);

    await runPicker.click();

    await expect(
      page.getByRole("menuitem", { name: "Fast Off", exact: true }),
    ).toBeVisible();
    const agentPicker = page.getByRole("menuitem", {
      name: /(Harness|智能体) Claude$/,
    });
    await expect(agentPicker).toHaveAttribute("aria-haspopup", "menu");
    await agentPicker.hover();
    await expect(
      page.getByRole("menuitem", { name: "Codex", exact: true }),
    ).toBeVisible();
  });

  test("sizes the approval selector like the other composer menus", async ({ page, bridge }) => {
    await bridge.setAgentSetupFixture({
      agents: [{
        id: "codex-acp",
        label: "Codex",
        command: "codex-acp",
        detected: true,
        available: true,
        installed: true,
      }],
    });
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-mode-layout",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "mode",
            name: "Session mode",
            category: "mode",
            type: "select",
            currentValue: "agent",
            options: [
              { value: "read-only", name: "Ask for approval" },
              { value: "agent", name: "Approve for me" },
              { value: "agent-full-access", name: "Full access" },
            ],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5.6-sol",
            options: [{ value: "gpt-5.6-sol", name: "GPT-5.6-Sol" }],
          },
        ],
      },
    });

    await page.getByRole("button", { name: "Approve for me", exact: true }).click();
    const approvalMenu = page.getByRole("menu");
    const approvalBox = await approvalMenu.boundingBox();
    expect(approvalBox).not.toBeNull();
    await page.keyboard.press("Escape");

    await page.locator('button[aria-label^="Run on "]').first().click();
    const configMenu = page.getByRole("menu");
    const configBox = await configMenu.boundingBox();
    expect(configBox).not.toBeNull();
    expect(Math.abs(approvalBox!.width - configBox!.width)).toBeLessThanOrEqual(2);
  });

  test("uses ringless, non-selectable focus feedback for composer selectors", async ({
    page,
    bridge,
  }) => {
    await bridge.setAgentSetupFixture({
      agents: [{
        id: "codex-acp",
        label: "Codex",
        command: "codex-acp",
        detected: true,
        available: true,
        installed: true,
      }],
    });
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-compact-selector-focus",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [
          {
            id: "mode",
            name: "Session mode",
            category: "mode",
            type: "select",
            currentValue: "agent",
            options: [
              { value: "read-only", name: "Ask for approval" },
              { value: "agent", name: "Approve for me" },
              { value: "agent-full-access", name: "Full access" },
            ],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-5.6-sol",
            options: [{ value: "gpt-5.6-sol", name: "GPT-5.6-Sol" }],
          },
        ],
      },
    });

    const approval = page.getByRole("button", {
      name: "Approve for me",
      exact: true,
    });
    const model = page.locator('button[aria-label^="Run on "]').first();
    const userSelect = await Promise.all([approval, model].map((control) =>
      control.evaluate((element) => getComputedStyle(element).userSelect),
    ));
    expect(userSelect).toEqual(["none", "none"]);

    await model.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    const focusAppearance = await model.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        outlineStyle: style.outlineStyle,
      };
    });
    expect(focusAppearance.boxShadow).toBe("none");
    expect(focusAppearance.outlineStyle).toBe("none");
    expect(focusAppearance.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
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
