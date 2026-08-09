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

  test("keeps equal space around the runtime row and folds ACP updates into Settings", async ({
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
          updateAvailable: true,
        }],
      });
      await enableAgent(page, "codex-acp");

      const settings = page.getByRole("link", { name: "Settings", exact: true });
      const acpUpdate = page.getByRole("link", { name: "1 ACP update available" });
      const updateBadge = settings.locator('[data-sidebar-agent-update-count="1"]');
      const runtime = page.locator('[data-composer-footer-control="runtime"]').first();
      const composer = page.locator(".composer-card").first();
      const composerFrame = page.locator('[data-chat-column="composer"]').first();
      await Promise.all(
        [settings, updateBadge, runtime, composer, composerFrame].map((item) =>
          expect(item).toBeVisible(),
        ),
      );
      await expect(acpUpdate).toHaveCount(0);
      await expect(settings).toHaveAttribute("href", "/settings/agents");

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
      await injectEvent(page, {
        type: "session.complete",
        session_id: sessionId,
        turn_id: "settings-return-turn",
      });
      await expect(page.getByText("settings return marker")).toBeVisible();
      await expect(page.locator('[data-chat-surface="main"]')).toBeVisible();

      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Back to app", exact: true }).click();

      await expect(page.locator('[data-chat-surface="main"]')).toBeVisible();
      await expect(page.getByText("settings return marker")).toBeVisible();
  });

  test("preserves an unfinished draft while visiting Settings", async ({ page }) => {
      const composer = page.getByRole("textbox");
      await composer.fill("keep this unfinished draft");

      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Back to app", exact: true }).click();

      await expect(page.getByRole("textbox")).toHaveValue("keep this unfinished draft");
  });

  test("uses a native CJK font stack for chat prose while code stays monospace", async ({
      page,
  }) => {
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      const turnId = "native-chat-typography";
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_message_chunk",
          messageId: "native-chat-typography-message",
          _meta: { codex: { phase: "final_answer" } },
          content: {
            type: "text",
            text: "中文排版 mixed with Latin and `inlineCode`.",
          },
        },
      });
      await injectEvent(page, {
        type: "session.complete",
        session_id: sessionId,
        turn_id: turnId,
      });

      const answer = page.locator('[data-session-turn-answer="true"]').last();
      await expect(answer).toContainText("中文排版 mixed with Latin");
      const families = await answer.evaluate((element) => ({
        prose: getComputedStyle(element.querySelector("p")!).fontFamily,
        code: getComputedStyle(element.querySelector("code")!).fontFamily,
      }));

      expect(families.prose).toContain("PingFang SC");
      expect(families.prose).not.toContain("Geist Variable");
      expect(families.code).toContain("JetBrains Mono Variable");
  });

  test("keeps runtime location out of the model menu", async ({ page, bridge }) => {
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

      const runChip = page.locator('button[aria-label^="Run on "]').first();
      await runChip.click();

      await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /^Runtime\b/ })).toHaveCount(0);
      await expect(page.locator('[data-composer-footer-control="runtime"]')).toBeVisible();
  });

  test("uses a clean symmetric model trigger without a leading agent badge", async ({
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

      const runChip = page.locator('button[aria-label^="Run on "]').first();
      await expect(runChip.locator('[aria-label="Codex"]')).toHaveCount(0);
      await expect(runChip).not.toContainText("·");
      const padding = await runChip.evaluate((element) => {
        const style = getComputedStyle(element);
        return { left: style.paddingLeft, right: style.paddingRight };
      });
      expect(padding.left).toBe(padding.right);
  });

  test("uses the shared compact width for the project selector", async ({ page }) => {
      await page.locator('[data-composer-footer-control="project"]').click();
      const projectMenu = page.locator('[data-slot="command"]').filter({
        has: page.getByPlaceholder("Choose project"),
      });
      await expect(projectMenu).toBeVisible();
      const menuBox = await projectMenu.boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.width).toBeLessThanOrEqual(282);
  });

  test("opens the project selector on its single current choice", async ({ page }) => {
      await page.locator('[data-composer-footer-control="project"]').click();
      const projectMenu = page.locator('[data-slot="command"]').filter({
        has: page.getByPlaceholder("Choose project"),
      });
      const highlighted = projectMenu.locator(
        '[data-slot="command-item"][data-selected="true"]',
      );
      await expect(highlighted).toHaveCount(1);
      await expect(highlighted).toHaveAttribute("data-checked", "true");
  });

  test("aligns activity icons and lets tool details collapse again", async ({
      page,
  }) => {
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      const turnId = "activity-alignment-collapse";
      for (const [index, title] of ["First command", "Second command"].entries()) {
        await injectEvent(page, {
          type: "session.event",
          session_id: sessionId,
          turn_id: turnId,
          event: {
            sessionUpdate: "tool_call",
            toolCallId: `grouped-tool-${index}`,
            kind: "execute",
            status: "completed",
            title,
            rawInput: { command: title.toLowerCase() },
          },
        });
      }
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_message_chunk",
          _meta: { codex: { phase: "commentary" } },
          content: { type: "text", text: "Then inspect the final command." },
        },
      });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "tool_call",
          toolCallId: "single-tool",
          kind: "execute",
          status: "completed",
          title: "Final command",
          rawInput: { command: "final command" },
          content: [{ type: "terminal", terminalId: "terminal-final" }],
        },
      });
      await injectEvent(page, {
        type: "session.complete",
        session_id: sessionId,
        turn_id: turnId,
      });

      const groupIcon = page
        .locator('[data-tool-group-trigger] [data-tool-group-icon-slot] svg')
        .first();
      const singleTool = page.locator('[data-tool-call-id="single-tool"]');
      const singleIcon = singleTool.locator('[data-tool-activity-identity] svg');
      const [groupIconBox, singleIconBox] = await Promise.all([
        groupIcon.boundingBox(),
        singleIcon.boundingBox(),
      ]);
      expect(groupIconBox).not.toBeNull();
      expect(singleIconBox).not.toBeNull();
      expect(Math.abs(groupIconBox!.x - singleIconBox!.x)).toBeLessThanOrEqual(0.5);

      const summary = singleTool.getByRole("button");
      const input = singleTool.locator('[data-tool-input="single-tool"]');
      const terminal = singleTool.locator('[data-tool-terminal-id="terminal-final"]');
      await expect(input).toBeHidden();
      await summary.click();
      await expect(input).toBeVisible();
      await expect(terminal).toBeVisible();
      await summary.click();
      await expect(input).toBeHidden();
      await expect(terminal).toBeHidden();
  });

  test("uses an inset thin overlay thumb that grows on hover without a native gutter", async ({
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
