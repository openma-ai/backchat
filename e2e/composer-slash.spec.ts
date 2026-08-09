import { expect, test } from "./fixtures";

import {
  enableAgent,
  injectAvailableCommands,
  injectSession,
} from "./helpers";

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
    await capture("skill-command-chip.png", "skill command chip");
    await composer.waitForPromptTexts([]);

    const instructionInput = page.locator('textarea[placeholder="Add instructions…"]');
    await instructionInput.fill("make the dashboard feel polished");
    await instructionInput.press("Enter");

    await composer.waitForPromptTexts(["/impeccable make the dashboard feel polished"]);
  });
});
