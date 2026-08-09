import { expect, test } from "./fixtures";
import { enableAgent, injectEvent, injectSession } from "./helpers";

test.describe("backchat smoke", () => {
  test("e2e launch keeps the window hidden by default", async ({ app }) => {
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some((win) => win.isVisible()),
          ),
        )
        .toBe(false);
  });

  test("empty state renders composer + sidebar chrome", async ({ page }) => {
      // Sidebar chrome — New chat + Search rows.
      await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
      await expect(page.locator("button", { hasText: "Search" }).first()).toBeVisible();

      // Empty-state title remains visible even when an agent is configured.
      await expect(page.getByRole("heading", { name: "Pick an agent" })).toBeVisible();
  });

  test("renders the sidebar as an opaque surface without backdrop compositing", async ({
      page,
  }) => {
      const sidebar = page.locator("aside.theme-sidebar-background");
      const composer = page.locator(".composer-card").first();
      await expect(sidebar).toBeVisible();
      await expect(composer).toBeVisible();

      const [material, colors] = await Promise.all([
        sidebar.evaluate((element) => {
        const style = getComputedStyle(element);
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return {
          backdropFilter: style.backdropFilter,
          alpha: context.getImageData(0, 0, 1, 1).data[3],
        };
        }),
        Promise.all([sidebar, composer].map((locator) =>
          locator.evaluate((element) => getComputedStyle(element).backgroundColor),
        )),
      ]);

      expect(material.backdropFilter).toBe("none");
      expect(material.alpha).toBe(255);
      expect(colors[1]).toBe(colors[0]);
  });

  test("uses semantic opaque surfaces and a distinct raised state", async ({
      page,
  }) => {
      await enableAgent(page, "codex-acp");
      await injectSession(page, {
        agentId: "codex-acp",
        cwd: "/tmp/backchat-semantic-surfaces",
      });

      const surfaces = {
        canvas: page.locator(".app-canvas-surface").first(),
        sidebar: page.locator("aside.app-rail-surface").first(),
        composer: page.locator(".composer-card.app-composer-surface").first(),
        raised: page.locator(".app-selected-surface").first(),
      };
      await Promise.all(Object.values(surfaces).map((surface) =>
        expect(surface).toBeVisible(),
      ));

      const colors = Object.fromEntries(await Promise.all(
        Object.entries(surfaces).map(async ([name, surface]) => [
          name,
          await surface.evaluate((element) => {
            const color = getComputedStyle(element).backgroundColor;
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const context = canvas.getContext("2d")!;
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return {
              color,
              alpha: context.getImageData(0, 0, 1, 1).data[3],
            };
          }),
        ]),
      ));

      expect(colors.sidebar.color).toBe(colors.composer.color);
      expect(colors.canvas.color).not.toBe(colors.sidebar.color);
      expect(colors.raised.color).not.toBe(colors.sidebar.color);
      expect(Object.values(colors).every(({ alpha }) => alpha === 255)).toBe(true);
  });

  test("aligns the Settings icon with the primary sidebar icon track", async ({
      page,
  }) => {
      const newChatIcon = page
        .getByRole("button", { name: "New chat", exact: true })
        .locator("svg");
      const settingsIcon = page
        .getByRole("link", { name: "Settings", exact: true })
        .locator("svg");

      const [newChatBox, settingsBox] = await Promise.all([
        newChatIcon.boundingBox(),
        settingsIcon.boundingBox(),
      ]);
      expect(newChatBox).not.toBeNull();
      expect(settingsBox).not.toBeNull();
      const newChatCenter = newChatBox!.x + newChatBox!.width / 2;
      const settingsCenter = settingsBox!.x + settingsBox!.width / 2;
      expect(Math.abs(newChatCenter - settingsCenter)).toBeLessThanOrEqual(0.5);
  });

  test("uses the compact row-action matrix for every sidebar overflow menu", async ({
      page,
  }) => {
      await injectSession(page, {
        sessionId: "sidebar-row-action",
        agentId: "codex-acp",
        cwd: "/tmp/sidebar-row-actions",
      });

      const navigation = page.getByRole("navigation");
      const projectActions = navigation.getByRole("button", {
        name: "Project actions",
        exact: true,
      });
      const sessionActions = navigation.getByRole("button", {
        name: "Session actions",
        exact: true,
      });
      await Promise.all([
        expect(projectActions).toBeAttached(),
        expect(sessionActions).toBeAttached(),
      ]);

      const matrices = await Promise.all([projectActions, sessionActions].map(
        (action) => action.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            width: Math.round(Number.parseFloat(style.width)),
            height: Math.round(Number.parseFloat(style.height)),
            radius: Math.round(Number.parseFloat(style.borderRadius)),
          };
        }),
      ));

      expect(matrices).toEqual([
        { width: 16, height: 16, radius: 8 },
        { width: 16, height: 16, radius: 8 },
      ]);
  });

  test("keeps equal space around the runtime row", async ({ page }) => {
      await enableAgent(page, "codex-acp");

      const settings = page.getByRole("link", { name: "Settings", exact: true });
      const runtime = page.locator('[data-composer-footer-control="runtime"]').first();
      const composer = page.locator(".composer-card").first();
      const composerFrame = page.locator('[data-chat-column="composer"]').first();
      await Promise.all(
        [settings, runtime, composer, composerFrame].map((item) =>
          expect(item).toBeVisible(),
        ),
      );

      const [settingsBox, runtimeBox, composerBox, composerFrameBox] = await Promise.all([
        settings.boundingBox(),
        runtime.boundingBox(),
        composer.boundingBox(),
        composerFrame.boundingBox(),
      ]);
      expect(settingsBox).not.toBeNull();
      expect(runtimeBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      expect(composerFrameBox).not.toBeNull();
      const composerBottom = composerBox!.y + composerBox!.height;
      const runtimeBottom = runtimeBox!.y + runtimeBox!.height;
      const composerFrameBottom = composerFrameBox!.y + composerFrameBox!.height;
      const gapAboveRuntime = runtimeBox!.y - composerBottom;
      const gapBelowRuntime = composerFrameBottom - runtimeBottom;
      const settingsCenter = settingsBox!.y + settingsBox!.height / 2;
      const runtimeCenter = runtimeBox!.y + runtimeBox!.height / 2;
      expect(gapAboveRuntime).toBeGreaterThan(0);
      expect(Math.abs(gapAboveRuntime - gapBelowRuntime)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(runtimeCenter - settingsCenter)).toBeLessThanOrEqual(2);
  });

  test("separates Settings from ACP updates and upgrades directly from a popover", async ({
      page,
      bridge,
  }) => {
      const availableAgent = {
        id: "codex-acp",
        label: "Codex",
        command: "codex-acp",
        detected: true,
        available: true,
        installed: true,
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        updateAvailable: true,
      };
      await bridge.setAgentSetupFixture({
        agents: [availableAgent],
        upgradeResults: {
          "codex-acp": [{
            ...availableAgent,
            installedVersion: "1.1.0",
            updateAvailable: false,
          }],
        },
      });
      await enableAgent(page, "codex-acp");

      const settings = page.getByRole("link", { name: "Settings", exact: true });
      const update = page.getByRole("button", { name: "1 ACP update available" });
      await Promise.all([settings, update].map((item) => expect(item).toBeVisible()));
      await expect(settings).toHaveAttribute("href", "/settings");
      await expect(settings.locator("button")).toHaveCount(0);

      const [settingsBox, updateBox] = await Promise.all([
        settings.boundingBox(),
        update.boundingBox(),
      ]);
      expect(settingsBox).not.toBeNull();
      expect(updateBox).not.toBeNull();
      expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(updateBox!.x + 0.5);

      const backgrounds = async () => Promise.all([settings, update].map((item) =>
        item.evaluate((element) => getComputedStyle(element).backgroundColor),
      ));
      const resting = await backgrounds();
      await settings.hover();
      await page.waitForTimeout(180);
      const settingsHovered = await backgrounds();
      expect(settingsHovered[0]).not.toBe(resting[0]);
      expect(settingsHovered[1]).toBe(resting[1]);
      await update.hover();
      await page.waitForTimeout(180);
      const updateHovered = await backgrounds();
      expect(updateHovered[0]).toBe(resting[0]);
      expect(updateHovered[1]).not.toBe(resting[1]);
      await update.click();
      const popover = page.locator('[data-sidebar-agent-update-popover="true"]');
      await expect(popover).toBeVisible();
      await expect(popover).toHaveAttribute("data-side", "top");
      await expect(popover).toHaveAttribute("data-align", "start");
      expect((await popover.boundingBox())?.width).toBeLessThanOrEqual(280);
      await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
      await expect(popover.locator('[data-agent-update-label="codex-acp"]'))
        .toHaveText("Codex");
      await expect(popover.getByText("1.0.0 → 1.1.0", { exact: true })).toBeVisible();

      const updateAction = popover.getByRole("button", { name: "Update Codex" });
      const updateColors = await updateAction.evaluate((element) => {
        const brandProbe = document.createElement("span");
        brandProbe.style.backgroundColor = "var(--brand)";
        document.body.append(brandProbe);
        const expected = getComputedStyle(brandProbe).backgroundColor;
        brandProbe.remove();
        return {
          actual: getComputedStyle(element).backgroundColor,
          expected,
        };
      });
      expect(updateColors.actual).toBe(updateColors.expected);

      await updateAction.click();
      await expect(popover.getByRole("button", { name: "Updating Codex" })).toBeDisabled();
      await expect(popover.getByRole("status")).toContainText("Codex updated to 1.1.0");
      await expect.poll(() => bridge.readAgentSetupCalls()).toEqual(
        expect.arrayContaining([{ type: "upgrade", id: "codex-acp" }]),
      );

      await page.keyboard.press("Escape");
      await expect(popover).toBeHidden();
      await expect(page.getByRole("button", { name: "1 ACP update available" }))
        .toHaveCount(0);

      await settings.click();
      await page.getByRole("link", { name: "Agents", exact: true }).click();
      await expect(page.getByText("Installed 1.1.0", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Upgrade", exact: true }))
        .toHaveCount(0);
  });

  test("keeps suggestion cards visually level with the resting composer", async ({
      page,
  }) => {
      const suggestion = page.locator(".home-suggestion-card").first();
      const composer = page.locator(".composer-card").first();
      await Promise.all([suggestion, composer].map((item) => expect(item).toBeVisible()));

      const [suggestionBox, composerBox] = await Promise.all([
        suggestion.boundingBox(),
        composer.boundingBox(),
      ]);
      expect(suggestionBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      expect(Math.abs(suggestionBox!.height - composerBox!.height)).toBeLessThanOrEqual(2);
  });

  test("returns from Settings to the active conversation", async ({ page }) => {
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, {
        agentId: "codex-acp",
        cwd: "/tmp/backchat-settings-return",
      });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "settings-return-turn",
        event: {
          sessionUpdate: "agent_message_chunk",
          messageId: "settings-return-message",
          _meta: { codex: { phase: "final_answer" } },
          content: { type: "text", text: "settings return marker" },
        },
      });
  test("home suggestion selection creates an editable composer template", async ({ page }) => {
      await page.locator('[data-suggestion-kind="shape"]').click();

      const options = page.getByRole("listbox", { name: "Shape an idea" });
      await expect(options).toBeVisible();
      await options.getByRole("option").first().click();

      const template = page.locator(".composer-template-row");
      await expect(template).toBeVisible();
      await expect(template).toContainText("Help me shape");
      await expect(template).toContainText("into a concrete plan");
      await expect(template.getByRole("textbox", { name: "idea" })).toBeFocused();
  });

  test("injected session.ready surfaces in sidebar + topbar", async ({ page }) => {
      await injectSession(page, { agentId: "claude-acp", cwd: "/tmp/wkspc" });

      // session.ready promotes the row from draft to ready and surfaces
      // its cwd on the topbar's CwdChip + the composer ProjectChipRow.
      // We assert one of them is visible — strictly identifying the
      // chip would require a test-id we don't have yet.
      const cwdChips = page.getByTitle("/tmp/wkspc");
      await expect(cwdChips.first()).toBeVisible();
      expect(await cwdChips.count()).toBeGreaterThan(0);
  });

  test("native subagent renders a side-chat task and result", async ({ page, capture }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await enableAgent(page, "codex-acp");
      const sid = await injectSession(page, {
        agentId: "codex-acp",
        cwd: "/tmp/backchat-native-subagent",
      });
      await injectEvent(page, {
        type: "session.native_subagent",
        session_id: sid,
        provider: "codex",
        tool_call_id: "spawn-native-e2e",
        child_id: "native-child-e2e",
        task: "Review the native subagent conversation surface",
        agent_type: "default",
        status: "complete",
        result: "The native child uses the ordinary side-chat transcript.",
      });

      const sideChat = page.locator('[data-chat-surface="side"]');
      const userMessage = sideChat.getByText(
        "Review the native subagent conversation surface",
        { exact: true },
      );
      await expect(userMessage).toBeVisible();
      await expect(
        sideChat.getByText(
          "The native child uses the ordinary side-chat transcript.",
          { exact: true },
        ),
      ).toBeVisible();

      await capture("native-subagent-sidechat.png", "native subagent side chat");
  });

  test("selected assistant text becomes a response annotation on the next prompt", async ({ page, bridge, capture }) => {
      await enableAgent(page, "codex-acp");
      const sid = await injectSession(page, { agentId: "codex-acp" });
      const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
      if (!(await closeSidePanel.isVisible())) {
        await page.getByRole("button", { name: "Open side panel" }).click();
      }
      await expect(closeSidePanel).toBeVisible();
      const turnId = "turn-annotation-source";
      const responseText = "Backchat keeps annotations attached to the next prompt.";
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: responseText },
        },
      });
      await injectEvent(page, {
        type: "session.complete",
        session_id: sid,
        turn_id: turnId,
      });

      const response = page.getByText(responseText, { exact: true });
      await expect(response).toBeVisible();
      await response.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode) throw new Error("assistant response has no text node");
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });

      await capture("response-selection-toolbar.png", "response selection toolbar");
      await expect(page.getByRole("button", { name: "More details" })).toHaveCount(0);
      await page.getByRole("button", { name: "Add to prompt" }).click();
      const editor = page.getByRole("dialog", { name: "Response annotation" });
      await expect(editor).toBeVisible();
      const commentInput = editor.getByPlaceholder("Add an optional comment…");
      const voiceButton = editor.getByRole("button", { name: "Record voice comment" });
      await expect(voiceButton).toBeVisible();
      await expect(
        editor.getByRole("button", { name: "Save annotation comment" }),
      ).toHaveCount(0);
      const annotationBadge = page.getByRole("button", {
        name: "Edit response annotation 1",
      });
      await expect(annotationBadge).toBeVisible();
      await expect(annotationBadge.locator("svg")).toHaveCount(1);
      await expect.poll(async () => {
        const [editorBox, currentBadgeBox] = await Promise.all([
          editor.boundingBox(),
          annotationBadge.boundingBox(),
        ]);
        if (!editorBox || !currentBadgeBox) return 0;
        return editorBox.x - currentBadgeBox.x - currentBadgeBox.width;
      }).toBeGreaterThanOrEqual(4);
      const [emptyEditorBox, emptyInputBox, badgeBox] = await Promise.all([
        editor.boundingBox(),
        commentInput.boundingBox(),
        annotationBadge.boundingBox(),
      ]);
      expect(emptyEditorBox).not.toBeNull();
      expect(emptyInputBox).not.toBeNull();
      expect(badgeBox).not.toBeNull();
      expect(emptyEditorBox!.width).toBeGreaterThanOrEqual(300);
      expect(emptyEditorBox!.width).toBeLessThanOrEqual(320);
      expect(emptyEditorBox!.height).toBeGreaterThanOrEqual(56);
      await expect.poll(() => editor.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).borderRadius),
      )).toBe(16);
      await page.waitForTimeout(250);
      await capture("response-annotation-empty-editor.png", "empty response annotation editor");

      await page.evaluate(() => {
        class MockSpeechRecognition {
          continuous = false;
          interimResults = false;
          lang = "";
          onresult: ((event: unknown) => void) | null = null;
          onend: (() => void) | null = null;

          start() {
            queueMicrotask(() => {
              this.onresult?.({
                results: [[{ transcript: "Voice note from selection." }]],
              });
              this.onend?.();
            });
          }

          stop() {
            this.onend?.();
          }
        }
        (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition =
          MockSpeechRecognition;
      });
      await voiceButton.click();
      await expect(commentInput).toHaveValue("Voice note from selection.");
      await expect(voiceButton).toHaveCount(0);

      await commentInput.fill("First line");
      await commentInput.press("Enter");
      await commentInput.type("Second line");
      await expect(commentInput).toHaveValue("First line\nSecond line");

      const comment = [
        "Keep this behavior,",
        "but explain why it matters.",
        "Preserve the selected context",
        "and these line breaks.",
      ].join("\n");
      await commentInput.fill(comment);
      await expect(commentInput).toHaveValue(comment);
      const saveButton = editor.getByRole("button", { name: "Save annotation comment" });
      await expect(saveButton).toBeVisible();
      await expect.poll(() => editor.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).borderRadius),
      )).toBeLessThanOrEqual(16);
      const [expandedEditorBox, expandedInputBox] = await Promise.all([
        editor.boundingBox(),
        commentInput.boundingBox(),
      ]);
      expect(expandedEditorBox).not.toBeNull();
      expect(expandedInputBox).not.toBeNull();
      expect(expandedEditorBox!.height).toBeGreaterThan(emptyEditorBox!.height + 40);
      expect(expandedInputBox!.height).toBeGreaterThan(emptyInputBox!.height + 40);
      await capture("response-annotation-editor.png", "response annotation editor");
      await saveButton.click();
      await expect(editor).toBeHidden();

      const annotationChip = page.getByRole("button", { name: "1 annotation" });
      await expect(annotationChip).toBeVisible();
      await capture("response-annotation-composer.png", "response annotation composer context");
      await annotationChip.click();
      const annotationPopover = page.locator(
        '[data-slot="popover-content"][aria-label="Response annotations"]',
      );
      await expect(annotationPopover).toBeVisible();
      await expect(annotationPopover.getByText("Selected text", { exact: true })).toBeVisible();
      await expect(
        annotationPopover.getByText(
          comment,
          { exact: true },
        ),
      ).toBeVisible();
      await capture("response-annotation-popover.png", "response annotation popover");
      await page.keyboard.press("Escape");

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.fill("Update the implementation notes.");
      await composer.press("Enter");

      await expect
        .poll(async () => (await bridge.readSessionPrompts()).map((call) => ({
          text: call.text,
          annotations: call.annotations,
        })))
        .toEqual([
          {
            text: "Update the implementation notes.",
            annotations: [
              {
                id: expect.any(String),
                source_session_id: sid,
                source_turn_id: turnId,
                text: responseText,
                comment,
              },
            ],
          },
        ]);
      await expect(annotationChip).toBeHidden();
  });

  test("selected response text can start a side chat with its annotation", async ({ page }) => {
      await enableAgent(page, "codex-acp");
      const sid = await injectSession(page, { agentId: "codex-acp" });
      const turnId = "turn-side-annotation";
      const responseText = "Use a side chat to explore this response independently.";
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: responseText },
        },
      });
      await injectEvent(page, {
        type: "session.complete",
        session_id: sid,
        turn_id: turnId,
      });

      const response = page.getByText(responseText, { exact: true });
      await response.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode) throw new Error("assistant response has no text node");
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });

      await page.getByRole("button", { name: "Ask in side chat" }).click();
      const sideChat = page.locator('[data-chat-surface="side"]');
      await expect(sideChat).toBeVisible();
      await expect(sideChat.getByRole("button", { name: "1 annotation" })).toBeVisible();
      await expect(
        page.locator('[data-chat-surface="main"]').getByRole("button", { name: "1 annotation" }),
      ).toHaveCount(0);
  });
});
