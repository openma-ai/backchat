import { expect, test } from "./fixtures";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  enableAgent,
  injectAvailableCommands,
  injectEvent,
  injectSession,
  reloadRenderer,
  waitForRunnableHarness,
} from "./helpers";

const fakeAcpAgentPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake-acp-agent.mjs",
);

test.describe("composer slash commands", () => {
  test("available commands populate the slash picker", async ({ page, composer, capture }) => {
    await enableAgent(page, "claude-acp");
    const sessionId = await injectSession(page);
    await injectAvailableCommands(page, sessionId, [
      { name: "compact", description: "Compress this conversation" },
      { name: "init", description: "Init a new project" },
      {
        name: "skill:review",
        description: "Review current changes",
        kind: "skill",
      },
    ]);

    await composer.input.fill("/");

    const panel = page.getByRole("listbox", { name: "Slash commands" });
    await expect(panel).toHaveClass(/app-overlay-surface/);
    await expect(panel).toHaveClass(/composer-card/);
    const composerCard = page
      .locator('[data-chat-surface="main"] .composer-card')
      .filter({ has: page.locator("textarea") })
      .first();
    await expect(composerCard).toBeVisible();
    const [panelBox, composerBox] = await Promise.all([
      panel.boundingBox(),
      composerCard.boundingBox(),
    ]);
    expect(panelBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(Math.abs(panelBox!.x - composerBox!.x)).toBeLessThan(1);
    expect(Math.abs(panelBox!.width - composerBox!.width)).toBeLessThan(1);
    await expect(page.getByRole("option", { name: /compact/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /init/i })).toBeVisible();
    await expect(panel.locator(".lucide-slash")).toHaveCount(0);
    await expect(panel.locator(".slash-command-icon")).toHaveCount(3);
    await expect(panel.locator(".lucide-box")).toHaveCount(1);
    await expect(panel.locator(".slash-command-section").nth(1)).toHaveCSS(
      "border-top-width",
      "0px",
    );
    await expect(panel.locator(".slash-command-description").first()).toHaveCSS(
      "text-align",
      "right",
    );
    const firstRowBox = await panel.getByRole("option").first().boundingBox();
    expect(firstRowBox).not.toBeNull();
    expect(firstRowBox!.height).toBe(40);
    await expect(panel.getByRole("option").first()).toHaveCSS(
      "min-height",
      "40px",
    );
    await capture("slash-command-picker.png", "slash command picker");
  });

  test("enter on a no-argument slash command sends it as an ACP prompt", async ({ page, composer }) => {
    const sessionId = await injectSession(page);
    await injectAvailableCommands(page, sessionId, [
      { name: "compact", description: "Compress this conversation" },
      {
        name: "init",
        description: "Init a new project",
        input: { hint: "project goal" },
      },
    ]);

    await composer.input.fill("/com");
    await composer.input.press("Enter");

    await composer.waitForPromptTexts(["/compact"]);
  });

  test("a long hint never truncates the command token", async ({ page, composer }) => {
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    // Codex's real `/goal`: a short token with a long argument hint, which
    // used to squeeze the token column down to "/…".
    await injectAvailableCommands(page, sessionId, [{
      name: "goal",
      description: "Set a goal to keep pursuing.",
      input: { hint: "[<objective>|clear|pause|resume]" },
      _meta: { commandAction: { kind: "prefixPrompt", presentation: "state" } },
    }]);

    await composer.input.fill("/goal");

    const token = page.locator(".slash-command-token").first();
    await expect(token).toHaveText("/goal");
    // The hint pill absorbs the squeeze instead of the identity token.
    expect(
      await token.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  });

  test("plan from a cold new chat switches state without starting a session", async ({ page }) => {
    // The shipped regression: a draft composer has no session catalogue, so
    // `/plan` fell through to the generic branch, promoted the draft and left
    // as a prompt — the sidebar filled up with sessions literally named
    // "/plan". A draft must apply the switch locally instead.
    await page.evaluate(
      async ({ nodePath, fakeAgentPath }) => {
        await window.backchat.settingsPatch({
          agents: [{
            id: "codex-acp",
            enabled: true,
            command_override: nodePath,
            args_override: [fakeAgentPath],
            env: [],
          }],
        });
      },
      { nodePath: process.execPath, fakeAgentPath: fakeAcpAgentPath },
    );
    await reloadRenderer(page);
    await waitForRunnableHarness(page);
    const sessionsBefore = await page.evaluate(
      async () => (await window.backchat.sessionsList()).length,
    );

    // The cold-create page renders its own composer, outside the chat surface.
    const draftInput = page.locator(".new-chat-page textarea").last();
    await draftInput.fill("/plan");
    // The host owns `/plan` for Codex even before a session exists, so the
    // picker offers it without any agent catalogue.
    await expect(
      page.getByRole("option", { name: /plan/i }).first(),
    ).toBeVisible();
    await draftInput.press("Enter");

    await expect(draftInput).toHaveValue("");
    // The draft keeps its plan choice as a config override and shows the chip
    // before any session exists.
    await expect(
      page.locator('[data-composer-session-state="true"]'),
    ).toBeVisible();
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        async () => (await window.backchat.sessionsList()).length,
      ),
    ).toBe(sessionsBefore);
  });

  test("plan switches session state locally and the chip can dismiss it", async ({ page, composer }) => {
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    const collaborationOptions = (currentValue: string) => [{
      id: "collaboration_mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue,
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
    }];
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-plan-config",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: collaborationOptions("default"),
      },
    });
    await injectAvailableCommands(page, sessionId, [{
      name: "plan",
      description: "Turn plan mode on.",
      _meta: {
        commandAction: {
          kind: "setConfigOption",
          configId: "collaboration_mode",
          value: "plan",
          resetValue: "default",
        },
      },
    }]);

    await composer.input.fill("/plan");
    await composer.input.press("Enter");

    // A session-state command never becomes a prompt.
    await expect(composer.input).toHaveValue("");
    await page.waitForTimeout(250);
    expect(await composer.readPromptTexts()).toEqual([]);

    // The agent acknowledges with a config update; the chip appears with
    // its dismiss affordance.
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-plan-config-ack",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: collaborationOptions("plan"),
      },
    });
    const chip = page.locator('[data-composer-session-state="true"]');
    await expect(chip).toBeVisible();
    // The whole chip is the exit control; the ⊗ replaces the plan icon
    // only while hovered.
    await expect(chip).toHaveAttribute(
      "data-composer-session-state-clear",
      "true",
    );
    const clearGlyph = chip.locator('[data-session-state-clear-glyph="true"]');
    await expect(clearGlyph).toHaveCSS("opacity", "0");
    await chip.hover();
    await expect(clearGlyph).toHaveCSS("opacity", "1");

    await chip.click();
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "e2e-plan-config-exit",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: collaborationOptions("default"),
      },
    });
    await expect(chip).toHaveCount(0);
  });

  test("escape dismisses the slash picker without editing the prompt", async ({ page, composer }) => {
    const sessionId = await injectSession(page);
    await injectAvailableCommands(page, sessionId, [
      { name: "compact", description: "Compress this conversation" },
    ]);

    await composer.input.fill("/");
    await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();

    await composer.input.press("Escape");

    await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeHidden();
    await expect(composer.input).toHaveValue("/");
  });

  test("slash command filtering accepts compact abbreviations", async ({ page, composer }) => {
    const sessionId = await injectSession(page);
    await injectAvailableCommands(page, sessionId, [
      { name: "compact", description: "Compress this conversation" },
      { name: "init", description: "Init a new project" },
    ]);

    await composer.input.fill("/cpt");

    await expect(page.getByRole("option", { name: /compact/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /init/i })).toBeHidden();
  });

  test("skill slash command renders a chip and sends ACP text after instructions", async ({ page, composer, capture }) => {
    const sessionId = await injectSession(page);
    await injectAvailableCommands(page, sessionId, [
      {
        name: "impeccable",
        description: "Create distinctive, production-grade frontend interfaces",
        kind: "skill",
      },
    ]);

    await composer.input.fill("/imp");
    await composer.input.press("Enter");

    const skillChip = page.getByRole("button", { name: "Skill Impeccable" });
    await expect(skillChip).toBeVisible();
    await expect
      .poll(() => skillChip.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe("rgba(0, 0, 0, 0)");

    // The token is inline: it sits on the textarea's first text line and
    // the caret continues after it via first-line indent.
    const instructionInput = page.locator('textarea[placeholder="Add instructions…"]');
    const [chipBox, inputBox, indent] = await Promise.all([
      skillChip.boundingBox(),
      instructionInput.boundingBox(),
      instructionInput.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).textIndent),
      ),
    ]);
    expect(chipBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(Math.abs(chipBox!.y + chipBox!.height / 2 - (inputBox!.y + 16))).toBeLessThanOrEqual(8);
    expect(indent).toBeGreaterThanOrEqual(chipBox!.width);

    await capture("skill-command-chip.png", "skill command chip");
    await composer.waitForPromptTexts([]);

    await instructionInput.fill("make the dashboard feel polished");
    await instructionInput.press("Enter");

    await composer.waitForPromptTexts(["/impeccable make the dashboard feel polished"]);
  });
});
