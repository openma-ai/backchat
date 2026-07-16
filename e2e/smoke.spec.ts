import { expect, test } from "@playwright/test";
import { injectEvent, injectSession, launchApp } from "./helpers";

test.describe("backchat smoke", () => {
  test("e2e launch keeps the window hidden by default", async () => {
    const { app, cleanup } = await launchApp();
    try {
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some((win) => win.isVisible()),
          ),
        )
        .toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("empty state renders composer + sidebar chrome", async () => {
    const { page, cleanup } = await launchApp();
    try {
      // Sidebar chrome — New chat + Search rows.
      await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
      await expect(page.locator("button", { hasText: "Search" }).first()).toBeVisible();

      // Empty-state title when no default agent has been selected.
      await expect(page.getByText("Pick a default agent")).toBeVisible();
    } finally {
      await cleanup();
    }
  });

  test("injected session.ready surfaces in sidebar + topbar", async () => {
    const { page, cleanup } = await launchApp();
    try {
      await injectSession(page, { agentId: "claude-acp", cwd: "/tmp/wkspc" });

      // session.ready promotes the row from draft to ready and surfaces
      // its cwd on the topbar's CwdChip + the composer ProjectChipRow.
      // We assert one of them is visible — strictly identifying the
      // chip would require a test-id we don't have yet.
      const cwdChips = page.getByTitle("/tmp/wkspc");
      await expect(cwdChips.first()).toBeVisible();
      expect(await cwdChips.count()).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test("native subagent renders as a side-chat conversation with a visible user bubble", async ({}, testInfo) => {
    const { page, cleanup } = await launchApp();
    try {
      await page.setViewportSize({ width: 1600, height: 1000 });
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
      const userBubble = sideChat.locator(
        '.is-user > [data-slot="message-content"]',
      );
      await expect(userBubble).toContainText(
        "Review the native subagent conversation surface",
      );
      await expect(
        sideChat.getByText(
          "The native child uses the ordinary side-chat transcript.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect
        .poll(() =>
          userBubble.evaluate((element) => {
            const probe = document.createElement("span");
            probe.style.background = "var(--bg-surface)";
            document.body.append(probe);
            const defaultBubbleColor = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return getComputedStyle(element).backgroundColor !== defaultBubbleColor;
          }),
        )
        .toBe(true);

      const screenshotPath = testInfo.outputPath(
        "native-subagent-sidechat.png",
      );
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach("native subagent side chat", {
        path: screenshotPath,
        contentType: "image/png",
      });
    } finally {
      await cleanup();
    }
  });

  test("available_commands_update populates the slash picker", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);

      // ACP `available_commands_update` is a session-scoped event — the
      // store wires it onto SessionRow.availableCommands. Composer reads
      // that when the textarea starts with "/" and opens the picker.
      // session.event needs a turn_id field; we pass a dummy one because
      // the reducer's session-scoped branch ignores it.
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
            { name: "init", description: "Init a new project" },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/");

      // Picker pops as a listbox with both commands as options.
      await expect(page.getByRole("option", { name: /compact/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /init/i })).toBeVisible();
    } finally {
      await cleanup();
    }
  });

  test("composer model picker switches the active session config option", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
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
      await page.getByRole("menuitem", { name: "GPT-5 Model" }).click();

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionConfigOptions().then(
              (calls: Array<{ config_id: string; value: string }>) =>
                calls.map((p) => ({ config_id: p.config_id, value: p.value })),
            ),
          ),
        )
        .toEqual([{ config_id: "model", value: "gpt-5" }]);
      await expect(modelPicker).toContainText("GPT-5");
    } finally {
      await cleanup();
    }
  });

  test("enter on a no-argument slash command sends it as an ACP prompt", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);

      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
            {
              name: "init",
              description: "Init a new project",
              input: { hint: "project goal" },
            },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/com");
      await composer.press("Enter");

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (calls: Array<{ text: string }>) => calls.map((p) => p.text),
            ),
          ),
        )
        .toEqual(["/compact"]);
    } finally {
      await cleanup();
    }
  });

  test("escape dismisses the slash picker without editing the prompt", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/");
      await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();

      await composer.press("Escape");

      await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeHidden();
      await expect(composer).toHaveValue("/");
    } finally {
      await cleanup();
    }
  });

  test("slash command filtering accepts compact abbreviations", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
            { name: "init", description: "Init a new project" },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/cpt");

      await expect(page.getByRole("option", { name: /compact/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /init/i })).toBeHidden();
    } finally {
      await cleanup();
    }
  });

  test("skill slash command renders as a composer chip and still sends ACP text", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            {
              name: "impeccable",
              description: "Create distinctive, production-grade frontend interfaces",
              kind: "skill",
            },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/imp");
      await composer.press("Enter");

      const skillChip = page.getByRole("button", { name: "Skill Impeccable" });
      await expect(skillChip).toBeVisible();
      await expect
        .poll(() =>
          skillChip.evaluate((el) => getComputedStyle(el).backgroundColor),
        )
        .toBe("rgba(0, 0, 0, 0)");
      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (calls: Array<{ text: string }>) => calls.map((p) => p.text),
            ),
          ),
        )
        .toEqual([]);

      const instructionInput = page.locator('textarea[placeholder="Add instructions…"]');
      await instructionInput.fill("make the dashboard feel polished");
      await instructionInput.press("Enter");

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (calls: Array<{ text: string }>) => calls.map((p) => p.text),
            ),
          ),
        )
        .toEqual(["/impeccable make the dashboard feel polished"]);
    } finally {
      await cleanup();
    }
  });

  test("plus button attaches images and files to the ACP prompt", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await page.evaluate(async () => {
        // @ts-expect-error — test bridge typed in preload/index.ts
        await window.__backchatTest.setPickedFiles([
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
      });

      await page.getByLabel("Attach files").click();

      await expect(page.getByRole("img", { name: "dashboard.svg" })).toBeVisible();
      await expect(page.locator('[aria-label="notes.md"]')).toBeVisible();
      await page.screenshot({
        path: "test-results/regression-proof/attachments-proof.png",
        fullPage: true,
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.fill("review these inputs");
      await composer.press("Enter");

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (
                calls: Array<{
                  text: string;
                  attachments?: Array<{ name: string; kind: string; mimeType?: string }>;
                }>,
              ) =>
                calls.map((p) => ({
                  text: p.text,
                  attachments: (p.attachments ?? []).map((a) => ({
                    name: a.name,
                    kind: a.kind,
                    mimeType: a.mimeType,
                  })),
                })),
            ),
          ),
        )
        .toEqual([
          {
            text: "review these inputs",
            attachments: [
              { name: "dashboard.svg", kind: "image", mimeType: "image/svg+xml" },
              { name: "notes.md", kind: "file", mimeType: "text/markdown" },
            ],
          },
        ]);
      await expect(page.locator('[aria-label="notes.md"]')).toBeHidden();
    } finally {
      await cleanup();
    }
  });

  test("selected assistant text becomes a response annotation on the next prompt", async ({}, testInfo) => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page, { agentId: "codex-acp" });
      const closeSidePanel = page.getByRole("button", { name: "Close side panel" });
      if (!(await closeSidePanel.isVisible())) {
        await page.getByRole("button", { name: "Open side chat" }).click();
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
      const selectedRect = await response.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const textNode = walker.nextNode();
        if (!textNode) throw new Error("assistant response has no text node");
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const rect = range.getBoundingClientRect();
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      });

      const selectionToolbarScreenshot = testInfo.outputPath("response-selection-toolbar.png");
      await page.screenshot({ path: selectionToolbarScreenshot });
      await testInfo.attach("response selection toolbar", {
        path: selectionToolbarScreenshot,
        contentType: "image/png",
      });
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
      const annotationBadge = page.locator("[data-response-annotation-badge]");
      await expect(annotationBadge).toBeVisible();
      await expect(annotationBadge.locator("svg")).toHaveCount(1);
      await expect.poll(async () => {
        const [editorBox, currentBadgeBox] = await Promise.all([
          editor.boundingBox(),
          annotationBadge.boundingBox(),
        ]);
        if (!editorBox || !currentBadgeBox) return 0;
        return editorBox.x - currentBadgeBox.x - currentBadgeBox.width;
      }).toBeGreaterThanOrEqual(12);
      const [emptyEditorBox, emptyInputBox, badgeBox] = await Promise.all([
        editor.boundingBox(),
        commentInput.boundingBox(),
        annotationBadge.boundingBox(),
      ]);
      expect(emptyEditorBox).not.toBeNull();
      expect(emptyInputBox).not.toBeNull();
      expect(badgeBox).not.toBeNull();
      expect(badgeBox!.x).toBeGreaterThanOrEqual(selectedRect.right + 4);
      expect(badgeBox!.x).toBeLessThanOrEqual(selectedRect.right + 5);
      expect(badgeBox!.y + badgeBox!.height).toBeLessThanOrEqual(selectedRect.top + 2);
      expect(badgeBox!.y + badgeBox!.height).toBeGreaterThanOrEqual(selectedRect.top - 1);
      expect(emptyEditorBox!.x).toBeGreaterThanOrEqual(
        badgeBox!.x + badgeBox!.width + 12,
      );
      expect(emptyEditorBox!.width).toBeGreaterThanOrEqual(300);
      expect(emptyEditorBox!.width).toBeLessThanOrEqual(320);
      expect(emptyEditorBox!.height).toBeGreaterThanOrEqual(56);
      await expect.poll(() => editor.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).borderRadius),
      )).toBe(16);
      const emptyEditorScreenshot = testInfo.outputPath(
        "response-annotation-empty-editor.png",
      );
      await page.waitForTimeout(250);
      await page.screenshot({ path: emptyEditorScreenshot });
      await testInfo.attach("empty response annotation editor", {
        path: emptyEditorScreenshot,
        contentType: "image/png",
      });

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
      const editorScreenshot = testInfo.outputPath("response-annotation-editor.png");
      await page.screenshot({ path: editorScreenshot });
      await testInfo.attach("response annotation editor", {
        path: editorScreenshot,
        contentType: "image/png",
      });
      await saveButton.click();
      await expect(editor).toBeHidden();

      const annotationChip = page.getByRole("button", { name: "1 annotation" });
      await expect(annotationChip).toBeVisible();
      const composerScreenshot = testInfo.outputPath("response-annotation-composer.png");
      await page.screenshot({ path: composerScreenshot });
      await testInfo.attach("response annotation composer context", {
        path: composerScreenshot,
        contentType: "image/png",
      });
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
      const popoverScreenshot = testInfo.outputPath("response-annotation-popover.png");
      await page.screenshot({ path: popoverScreenshot });
      await testInfo.attach("response annotation popover", {
        path: popoverScreenshot,
        contentType: "image/png",
      });
      await page.keyboard.press("Escape");

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.fill("Update the implementation notes.");
      await composer.press("Enter");

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (calls: Array<{
                text: string;
                annotations?: Array<{ text: string; comment?: string }>;
              }>) => calls.map((call) => ({
                text: call.text,
                annotations: call.annotations,
              })),
            ),
          ),
        )
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
    } finally {
      await cleanup();
    }
  });

  test("selected response text can start a side chat with its annotation", async () => {
    const { page, cleanup } = await launchApp();
    try {
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
    } finally {
      await cleanup();
    }
  });
});
