import { resolve } from "node:path";

import { expect, test } from "./fixtures";

import { injectSession } from "./helpers";

test.describe("composer mentions and attachments", () => {
  test("keeps the idle composer at its three-row height", async ({
      page,
      composer,
      bridge,
      capture,
  }) => {
      await bridge.injectSessionRow({
        session_id: "e2e-compact-composer",
        agent_id: "claude-acp",
        cwd: "/tmp/backchat-test",
      });
      await page
        .getByRole("button", { name: "claude-acp · e2e-co" })
        .click({ force: true });

      const card = composer.input.locator(
        "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' composer-card ')][1]",
      );
      await expect(card).toBeVisible();

      const cardBox = await card.boundingBox();
      const inputBox = await composer.input.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(inputBox).not.toBeNull();
      expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(120);
      expect(cardBox?.height ?? Infinity).toBeLessThanOrEqual(132);
      expect(inputBox?.height ?? 0).toBeGreaterThanOrEqual(60);
      expect(inputBox?.height ?? Infinity).toBeLessThanOrEqual(64);
      await capture("composer-three-row.png", "three-row composer");
  });

  test("omits the session mention shortcut from the composer toolbar", async ({
      page,
      bridge,
  }) => {
      await bridge.injectSessionRow({
        session_id: "e2e-no-mention-shortcut",
        agent_id: "claude-acp",
        cwd: "/tmp/backchat-test",
      });
      await page
        .getByRole("button", { name: "claude-acp · e2e-no" })
        .click({ force: true });

      await expect(
        page.getByRole("button", { name: "Mention another session" }),
      ).toHaveCount(0);
  });

  test("does not mount the right panel on the Pick an agent state", async ({
      page,
      bridge,
  }) => {
      await page.evaluate(async () => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          agents: current.agents.map((agent) => ({
            ...agent,
            enabled: false,
          })),
        });
      });
      await bridge.injectSessionRow({
        session_id: "e2e-pick-agent",
        agent_id: "claude-acp",
        cwd: "/tmp/backchat-test",
      });
      await page
        .getByRole("button", { name: "claude-acp · e2e-pi" })
        .click({ force: true });

      await expect(page.getByText("Pick an agent", { exact: true })).toBeVisible();
      await expect(page.getByPlaceholder("Ask anything…")).toBeVisible();
      await expect(page.getByText("Context fork", { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /(?:Open|Close) side panel/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /(?:Open|Close) terminal/ }),
      ).toHaveCount(0);
  });

  test("mentions another session as a removable, navigable inline chip", async ({ page, composer, capture }) => {
      const referencedSessionId = await injectSession(page, { agentId: "claude-acp" });
      await injectSession(page, { agentId: "codex-acp" });

      await composer.fillMention();
      await composer.mentionPicker().waitFor({ state: "visible" });
      await capture("session-mention-picker.png", "session mention picker");
      await composer.pickMention(new RegExp(referencedSessionId.slice(0, 6)));
      await capture("session-mention-inline-chip.png", "session mention inline chip");

      await expect(page.locator('[data-slot="composer-inline-content"]'))
        .toContainText(/claude-acp.*e2e-/);
      await expect(composer.sessionRemoveButton()).toBeVisible();
      await expect(composer.input).toHaveValue("");
      await composer.sessionOpenButton().click();
      await expect(
        page.locator("header").getByText(new RegExp(referencedSessionId.slice(0, 6))),
      ).toBeVisible();
  });

  test("includes a session reference in the sent prompt", async ({ page, composer }) => {
      const referencedSessionId = await injectSession(page, { agentId: "claude-acp" });
      const currentSessionId = await injectSession(page, { agentId: "codex-acp" });

      await composer.fillMention();
      await composer.pickMention(new RegExp(referencedSessionId.slice(0, 6)));
      await composer.send("Summarize the referenced session.");
      await composer.waitForPromptCount(1);

      const [prompt] = await composer.readPrompts();
      expect(prompt).toMatchObject({
        session_id: currentSessionId,
        text: "Summarize the referenced session.",
        session_references: [{ session_id: referencedSessionId }],
      });
      await expect(page.getByText("Summarize the referenced session.", { exact: true }))
        .toBeVisible();
  });

  test("mentions a workspace file inline and sends it as an attachment", async ({ page, composer, capture }) => {
      const sessionId = await injectSession(page, {
        agentId: "codex-acp",
        cwd: process.cwd(),
      });
      await composer.fillMention("package");
      await composer.pickMention(/package\.json/);
      const fileChip = composer.fileChip("package.json");
      await expect(fileChip).toBeVisible();
      await composer.expectInlineMentionLayout(fileChip);
      await expect(composer.input).toHaveValue("");

      await capture("file-mention-attached.png", "workspace file mention");

      await composer.send("Read the mentioned file.");
      await composer.waitForPromptCount(1);
      const [prompt] = await composer.readPrompts();
      expect(prompt.session_id).toBe(sessionId);
      expect(prompt.attachments).toEqual([
        expect.objectContaining({
          name: "package.json",
          path: resolve(process.cwd(), "package.json"),
        }),
      ]);
  });

  test("opens the native picker for a file outside the current project", async ({ page, composer, capture }) => {
      const sessionId = await injectSession(page, {
        agentId: "codex-acp",
        cwd: process.cwd(),
      });
      await composer.setPickedFiles([{
        id: "outside-file",
        name: "shared-notes.md",
        path: "/tmp/openma-shared/shared-notes.md",
        uri: "file:///tmp/openma-shared/shared-notes.md",
        kind: "file",
        mimeType: "text/markdown",
        size: 42,
      }]);

      await composer.fillMention("shared");
      await composer.pickBrowseFile();
      const fileChip = composer.fileChip("shared-notes.md");
      await expect(fileChip).toBeVisible();
      await composer.expectInlineMentionLayout(fileChip);
      await expect(composer.input).toHaveValue("");

      await capture("file-mention-outside-attached.png", "outside-project file mention");

      await composer.send("Read the shared notes.");
      await composer.waitForPromptCount(1);
      const [prompt] = await composer.readPrompts();
      expect(prompt.session_id).toBe(sessionId);
      expect(prompt.attachments).toEqual([
        expect.objectContaining({
          name: "shared-notes.md",
          path: "/tmp/openma-shared/shared-notes.md",
        }),
      ]);
  });

  test("keeps native image/file uploads in a separate attachment row", async ({ page, composer, capture }) => {
      const sessionId = await injectSession(page);
      await composer.setPickedFiles([
        {
          id: "att-image",
          name: "dashboard.svg",
          path: "/tmp/backchat-test/dashboard.svg",
          uri: "file:///tmp/backchat-test/dashboard.svg",
          kind: "image",
          mimeType: "image/svg+xml",
          size: 179,
          data: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMmY4MGVkIi8+PGNpcmNsZSBjeD0iNDAiIGN5PSI0MCIgcj0iMjIiIGZpbGw9IiNmZmZmZmYiLz48L3N2Zz4=",
        },
        {
          id: "att-file",
          name: "notes.md",
          path: "/tmp/backchat-test/notes.md",
          uri: "file:///tmp/backchat-test/notes.md",
          kind: "file",
          mimeType: "text/markdown",
          size: 42,
        },
      ]);

      await page.getByLabel("Attach files").click();
      await expect(page.getByRole("img", { name: "dashboard.svg" })).toBeVisible();
      const uploaded = page.locator('[aria-label="notes.md"]');
      await expect(uploaded).toBeVisible();
      await composer.expectStandaloneAttachmentLayout(uploaded);
      await capture("uploaded-attachments-row.png", "native attachments row");

      await composer.send("review these inputs");
      await composer.waitForPromptCount(1);
      const [prompt] = await composer.readPrompts();
      expect(prompt).toMatchObject({
        session_id: sessionId,
        text: "review these inputs",
        attachments: [
          { name: "dashboard.svg", kind: "image", mimeType: "image/svg+xml" },
          { name: "notes.md", kind: "file", mimeType: "text/markdown" },
        ],
      });
      await expect(uploaded).toBeHidden();
  });
});
