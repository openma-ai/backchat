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

  test("multi-clicking a composer control never selects transcript text", async ({
      page,
  }) => {
      await enableAgent(page, "codex-acp");
      const sid = await injectSession(page, { agentId: "codex-acp" });
      const turnId = "turn-selection-guard";
      const responseText = "Limits: data not available yet";
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
      await expect(page.getByText(responseText, { exact: true })).toBeVisible();

      const chip = page.locator('button[aria-label^="Run on "]').first();
      const readSelection = () =>
        page.evaluate(() => window.getSelection()?.toString() ?? "");

      // Chromium multi-click selection resolves through select-none chrome
      // onto the nearest transcript text; the shell guard must stop it.
      await chip.dblclick();
      expect(await readSelection()).toBe("");
      await page.keyboard.press("Escape");
      await chip.click({ clickCount: 3 });
      expect(await readSelection()).toBe("");
      await page.keyboard.press("Escape");

      // A real text selection survives a plain chip click — that linkage is
      // what carries a selection into "add to prompt".
      await page.getByText(responseText, { exact: true }).dblclick();
      expect(await readSelection()).not.toBe("");
      await chip.click();
      expect(await readSelection()).not.toBe("");
      await page.keyboard.press("Escape");
  });

  test("keeps chrome text unselectable while editors keep real selections", async ({
      page,
  }) => {
      const heading = page.getByRole("heading").first();
      const composer = page.locator(".composer-card").first();
      const [headingBox, composerBox] = await Promise.all([
        heading.boundingBox(),
        composer.boundingBox(),
      ]);
      expect(headingBox).not.toBeNull();
      expect(composerBox).not.toBeNull();

      // Drag from chrome text down into the composer — the exact gesture that
      // used to leave disconnected blue fragments across the UI.
      await page.mouse.move(headingBox!.x + 12, headingBox!.y + headingBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        composerBox!.x + composerBox!.width / 2,
        composerBox!.y + 16,
        { steps: 10 },
      );
      await page.mouse.up();

      const policy = await page.evaluate(() => ({
        selection: window.getSelection()?.toString() ?? "",
        body: getComputedStyle(document.body).userSelect,
        editor: getComputedStyle(document.querySelector("textarea")!).userSelect,
      }));
      expect(policy).toEqual({ selection: "", body: "none", editor: "text" });
  });

  test("applies the Cursor-aligned default light palette and interaction overlays", async ({
      page,
  }) => {
      await page.evaluate(async () => {
        const current = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({
          appearance: {
            ...current.appearance,
            theme: "light",
            light_theme_id: "backchat-light",
          },
        });
      });
      await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "light");

      const palette = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        const resolvedColor = (value: string) => {
          const probe = document.createElement("span");
          probe.style.backgroundColor = value;
          document.body.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return color;
        };
        return {
          canvas: getComputedStyle(document.querySelector(".app-canvas-surface")!).backgroundColor,
          panel: getComputedStyle(document.querySelector(".app-rail-surface")!).backgroundColor,
          composer: getComputedStyle(document.querySelector(".app-composer-surface")!).backgroundColor,
          foreground: resolvedColor("var(--fg)"),
          brand: resolvedColor("var(--brand)"),
          border: resolvedColor("var(--border)"),
          focus: resolvedColor("var(--focus-ring)"),
          hover: resolvedColor("var(--interaction-bg-hover)"),
          active: resolvedColor("var(--interaction-bg-active)"),
          tokenValues: {
            bg: rootStyle.getPropertyValue("--bg").trim(),
            panel: rootStyle.getPropertyValue("--bg-surface").trim(),
          },
        };
      });

      expect(palette).toMatchObject({
        canvas: "rgb(252, 252, 252)",
        panel: "rgb(243, 243, 243)",
        composer: "rgb(243, 243, 243)",
        foreground: "rgb(20, 20, 20)",
        brand: "rgb(248, 79, 50)",
        border: "rgba(20, 20, 20, 0.08)",
        focus: "rgba(20, 20, 20, 0.2)",
        tokenValues: {
          bg: "#fcfcfc",
          panel: "#f3f3f3",
        },
      });
      expect(palette.hover).toBe(palette.active);
      expect(Number(palette.hover.match(/[\d.]+(?=\))/)?.[0] ?? 1)).toBeLessThanOrEqual(0.08);
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

      // Nav rows and project rows share one icon rail; project children
      // indent exactly one icon-box step deeper.
      const iconBoxes = await Promise.all([
        page.getByTestId("new-chat-button").locator(".sidebar-row-icon").boundingBox(),
        navigation.locator(".sidebar-row-icon").first().boundingBox(),
        navigation.locator(".sidebar-row-icon").last().boundingBox(),
      ]);
      for (const box of iconBoxes) expect(box).not.toBeNull();
      const [navIcon, projectIcon, childIcon] = iconBoxes;
      expect(Math.abs(projectIcon!.x - navIcon!.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(childIcon!.x - navIcon!.x - 16)).toBeLessThanOrEqual(0.5);
      expect(projectIcon!.width).toBeCloseTo(navIcon!.width, 3);
      expect(childIcon!.width).toBeCloseTo(navIcon!.width, 3);
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

  test("marks the model trigger with the harness identity", async ({
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
      // The harness mark identifies who runs the prompt; the label itself
      // stays a plain model name without separator noise.
      await expect(
        runChip.locator('[data-composer-run-harness="true"]'),
      ).toHaveCount(1);
      await expect(runChip).not.toContainText("·");
  });

  test("uses the selected surface for an open compact selector", async ({
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

      const newChat = page.getByTestId("new-chat-button");
      const model = page.locator('button[aria-label^="Run on "]').first();
      await expect(newChat).toHaveAttribute("aria-current", "page");

      // The selected row is pre-composited (opaque) while an open control
      // paints the translucent interaction wash over its own panel, so the
      // contract is the rendered color, not the raw token string.
      const composited = (locator: typeof newChat) =>
        locator.evaluate((element) => {
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d")!;
          const alphaOf = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return context.getImageData(0, 0, 1, 1).data[3]!;
          };
          const layers = [getComputedStyle(element).backgroundColor];
          let surface: Element | null = element.parentElement;
          while (surface) {
            const color = getComputedStyle(surface).backgroundColor;
            layers.push(color);
            if (alphaOf(color) === 255) break;
            surface = surface.parentElement;
          }
          context.clearRect(0, 0, 1, 1);
          for (const color of layers.reverse()) {
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
          }
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
          return { r, g, b, a };
        });

      const selectedBackground = await composited(newChat);
      expect(selectedBackground.a).toBe(255);

      await model.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.waitForTimeout(180);
      const openBackground = await composited(model);
      // 8-bit canvas compositing and CSS color-mix round independently.
      expect(openBackground.a).toBe(255);
      expect(Math.abs(openBackground.r - selectedBackground.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(openBackground.g - selectedBackground.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(openBackground.b - selectedBackground.b)).toBeLessThanOrEqual(1);
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
      page,
      bridge,
  }) => {
      await page.setViewportSize({ width: 1200, height: 600 });
      for (let index = 0; index < 24; index += 1) {
        await bridge.injectSessionRow({
          session_id: `sidebar-overflow-${String(index).padStart(2, "0")}`,
          agent_id: "codex-acp",
          cwd: "",
        });
      }

      const scrollArea = page.locator('[data-sidebar-scroll-area="true"]');
      await expect(scrollArea).toBeVisible();
      const scrollbar = scrollArea.locator('[data-slot="scroll-area-scrollbar"]');
      const thumb = scrollArea.locator('[data-slot="scroll-area-thumb"]');
      await expect(scrollbar).toHaveCount(1);

      const viewport = scrollArea.locator('[data-slot="scroll-area-viewport"]');
      const dimensions = await viewport.evaluate((element) => ({
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        offsetWidth: (element as HTMLElement).offsetWidth,
        scrollHeight: element.scrollHeight,
      }));
      expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
      expect(dimensions.offsetWidth - dimensions.clientWidth).toBe(0);

      const [scrollAreaBox, scrollbarBox, restingThumbBox] = await Promise.all([
        scrollArea.boundingBox(),
        scrollbar.boundingBox(),
        thumb.boundingBox(),
      ]);
      expect(scrollAreaBox).not.toBeNull();
      expect(scrollbarBox).not.toBeNull();
      expect(restingThumbBox).not.toBeNull();
      expect(Math.round(scrollbarBox!.width)).toBe(8);
      expect(
        Math.round(
          scrollAreaBox!.x + scrollAreaBox!.width - scrollbarBox!.x - scrollbarBox!.width,
        ),
      ).toBe(0);
      expect(Math.round(restingThumbBox!.width)).toBe(4);
      expect(Math.round(
        scrollbarBox!.x + scrollbarBox!.width - restingThumbBox!.x - restingThumbBox!.width,
      )).toBe(2);

      await scrollbar.hover();
      await expect
        .poll(async () => Math.round((await thumb.boundingBox())?.width ?? 0))
        .toBe(6);
      await expect
        .poll(async () => {
          const [hoveredScrollbarBox, hoveredThumbBox] = await Promise.all([
            scrollbar.boundingBox(),
            thumb.boundingBox(),
          ]);
          if (!hoveredScrollbarBox || !hoveredThumbBox) return -1;
          return Math.round(
            hoveredScrollbarBox.x + hoveredScrollbarBox.width
              - hoveredThumbBox.x - hoveredThumbBox.width,
          );
        })
        .toBe(1);
  });

  test("shows sidebar boundary lines only while content continues beyond that edge", async ({
      page,
      bridge,
  }) => {
      await page.setViewportSize({ width: 1200, height: 600 });
      for (let index = 0; index < 24; index += 1) {
        await bridge.injectSessionRow({
          session_id: `sidebar-boundary-${String(index).padStart(2, "0")}`,
          agent_id: "codex-acp",
          cwd: "",
        });
      }

      const scrollArea = page.locator('[data-sidebar-scroll-area="true"]');
      const viewport = scrollArea.locator('[data-slot="scroll-area-viewport"]');
      const top = scrollArea.locator('[data-sidebar-scroll-boundary="top"]');
      const bottom = scrollArea.locator('[data-sidebar-scroll-boundary="bottom"]');

      const boundaryAppearance = await Promise.all([top, bottom].map((boundary) =>
        boundary.evaluate((element) => {
          const style = getComputedStyle(element);
          const expectedColorProbe = document.createElement("span");
          expectedColorProbe.style.backgroundColor =
            "color-mix(in srgb, var(--border) 72%, transparent)";
          document.body.append(expectedColorProbe);
          const expectedColor = getComputedStyle(expectedColorProbe).backgroundColor;
          expectedColorProbe.remove();
          return {
            height: Number.parseFloat(style.height),
            backgroundColor: style.backgroundColor,
            expectedColor,
          };
        }),
      ));
      for (const appearance of boundaryAppearance) {
        expect(appearance.height).toBeGreaterThan(0.45);
        expect(appearance.height).toBeLessThan(0.55);
        expect(appearance.backgroundColor).toBe(appearance.expectedColor);
      }

      await expect(top).toHaveAttribute("data-visible", "false");
      await expect(bottom).toHaveAttribute("data-visible", "true");

      await viewport.evaluate((element) => {
        element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) / 2);
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await expect(top).toHaveAttribute("data-visible", "true");
      await expect(bottom).toHaveAttribute("data-visible", "true");

      await viewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await expect(top).toHaveAttribute("data-visible", "true");
      await expect(bottom).toHaveAttribute("data-visible", "false");

      const [scrollAreaBox, topBox] = await Promise.all([
        scrollArea.boundingBox(),
        top.boundingBox(),
      ]);
      expect(scrollAreaBox).not.toBeNull();
      expect(topBox).not.toBeNull();
      expect(Math.abs(topBox!.x - scrollAreaBox!.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(topBox!.width - scrollAreaBox!.width)).toBeLessThanOrEqual(0.5);
  });

  test("keeps the model selector and submit hover states independent", async ({
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
      await page.getByRole("textbox").fill("hello");

      const runChip = page.locator('button[aria-label^="Run on "]').first();
      const submit = page.getByRole("button", { name: "Send (Enter)", exact: true });
      await expect(runChip).toBeVisible();
      await expect(submit).toBeEnabled();

      const appearance = () => Promise.all([runChip, submit].map((item) =>
        item.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            color: style.color,
            backgroundColor: style.backgroundColor,
          };
        }),
      ));
      await page.waitForTimeout(180);
      const resting = await appearance();

      await runChip.hover();
      await page.waitForTimeout(180);
      const selectorHovered = await appearance();
      expect(selectorHovered[0]).not.toEqual(resting[0]);
      expect(selectorHovered[1]).toEqual(resting[1]);

      await submit.hover();
      await page.waitForTimeout(180);
      const submitHovered = await appearance();
      expect(submitHovered[0]).toEqual(resting[0]);
      expect(submitHovered[1]).not.toEqual(resting[1]);
  });

  test("keeps compact composer controls above a transparent runtime and context footer", async ({
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
      const sessionId = await injectSession(page, {
        agentId: "codex-acp",
        cwd: "/tmp/backchat-composer-footer",
      });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "usage-footer",
        event: { sessionUpdate: "usage_update", used: 30, size: 100 },
      });

      const card = page.locator(".composer-card").first();
      const footer = page.locator('[data-session-runtime="true"]').first();
      const runtime = footer.locator('[data-session-runtime-location="true"]');
      const context = footer.locator('[data-gui-feature="output.usage-parent"]');
      await Promise.all([card, footer, runtime, context].map((item) => expect(item).toBeVisible()));

      const [cardBox, footerBox] = await Promise.all([card.boundingBox(), footer.boundingBox()]);
      expect(cardBox).not.toBeNull();
      expect(footerBox).not.toBeNull();
      expect(footerBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height);
      expect(await footer.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe("rgba(0, 0, 0, 0)");

      const controls = [
        card.getByRole("button", { name: "Attach files" }),
        card.getByRole("button", { name: "Ask each time" }),
        card.locator('button[aria-label^="Run on "]').first(),
        card.getByRole("button", { name: "Send (Enter)" }),
      ];
      for (const control of controls) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeLessThanOrEqual(28);
      }
  });

  test("keeps the runtime trigger background transparent while its menu is open", async ({
      page,
  }) => {
      const runtime = page.locator('[data-session-runtime-location="true"]').first();
      await expect(runtime).toBeVisible();

      await runtime.click();
      await expect(page.getByRole("menu")).toBeVisible();
      expect(await runtime.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe("rgba(0, 0, 0, 0)");
  });

  test("keeps the context meter out of native text selection", async ({
      page,
  }) => {
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "context-selection-boundary",
        event: { sessionUpdate: "usage_update", used: 30_000, size: 258_000 },
      });

      const context = page.locator('[data-gui-feature="output.usage-parent"]');
      await expect(context).toBeVisible();
      expect(await context.evaluate((element) => getComputedStyle(element).userSelect))
        .toBe("none");
  });

  test("aligns footer icons to the activity rail and keeps the attachment inset square", async ({
      page,
  }) => {
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "shared-icon-rail",
        event: {
          sessionUpdate: "tool_call",
          toolCallId: "shared-icon-rail-tool",
          kind: "execute",
          status: "completed",
          title: "Verify icon rail",
          rawInput: { command: "true" },
        },
      });

      const card = page.locator(".composer-card").first();
      const attachButton = page.getByRole("button", { name: "Attach files" });
      const attachIcon = page.getByRole("button", { name: "Attach files" }).locator("svg");
      const runtimeIcon = page
        .locator('[data-session-runtime-location="true"] [data-control-icon] svg');
      const activityIcon = page
        .locator('[data-tool-call-id="shared-icon-rail-tool"] [data-tool-activity-identity] svg');
      const [cardBox, attachButtonBox, attachBox, runtimeBox, activityBox] = await Promise.all([
        card.boundingBox(),
        attachButton.boundingBox(),
        attachIcon.boundingBox(),
        runtimeIcon.boundingBox(),
        activityIcon.boundingBox(),
      ]);
      expect(cardBox).not.toBeNull();
      expect(attachButtonBox).not.toBeNull();
      expect(attachBox).not.toBeNull();
      expect(runtimeBox).not.toBeNull();
      expect(activityBox).not.toBeNull();
      const attachCenter = attachBox!.x + attachBox!.width / 2;
      const runtimeCenter = runtimeBox!.x + runtimeBox!.width / 2;
      const activityCenter = activityBox!.x + activityBox!.width / 2;
      expect.soft(Math.abs(attachCenter - activityCenter)).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(runtimeCenter - activityCenter)).toBeLessThanOrEqual(1);

      const attachmentLeftInset = attachButtonBox!.x - cardBox!.x;
      const attachmentBottomInset = cardBox!.y + cardBox!.height
        - (attachButtonBox!.y + attachButtonBox!.height);
      expect.soft(Math.abs(attachmentLeftInset - attachmentBottomInset)).toBeLessThanOrEqual(1);
  });

  test("uses the same product-owned scroll area in Settings", async ({ page }) => {
      await page.getByRole("link", { name: "Settings", exact: true }).click();

      const scrollArea = page.locator('[data-settings-sidebar-scroll-area="true"]');
      await expect(scrollArea).toBeVisible();
      await expect(
        scrollArea.locator('[data-slot="scroll-area-viewport"]'),
      ).toHaveCount(1);
      await expect(
        scrollArea.locator('[data-slot="scroll-area-scrollbar"]'),
      ).toHaveCount(1);
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
