import { expect, test } from "./fixtures";
import { injectAvailableCommands, injectEvent, injectSession } from "./helpers";

test.describe("composer progress semantics", () => {
  test("aligns Claude and Codex Plan Mode in the shared composer bottom slot", async ({
    page,
    capture,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });

    const claudeSessionId = await injectSession(page, {
      agentId: "claude-acp",
    });
    await injectEvent(page, {
      type: "session.event",
      session_id: claudeSessionId,
      turn_id: "",
      event: {
        sessionUpdate: "current_mode_update",
        currentModeId: "plan",
      },
    });

    const stateSlot = page.locator('[data-composer-session-state="true"]');
    const progress = page.locator('[data-composer-progress="true"]');
    await expect(stateSlot).toBeVisible();
    await expect(stateSlot).toHaveAttribute(
      "data-session-state-kind",
      "plan_mode",
    );
    await expect(stateSlot).toContainText("Plan");
    await expect(progress).toHaveCount(0);

    await injectEvent(page, {
      type: "session.event",
      session_id: claudeSessionId,
      turn_id: "",
      event: {
        sessionUpdate: "current_mode_update",
        currentModeId: "default",
      },
    });
    await expect(stateSlot).toBeHidden();

    const codexSessionId = await injectSession(page, {
      agentId: "codex-acp",
    });
    await injectEvent(page, {
      type: "session.event",
      session_id: codexSessionId,
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: {
              objective: "Keep the migration moving",
              status: "active",
            },
          },
        },
      },
    });
    const collaborationOption = (currentValue: "default" | "plan") => ({
      id: "collaboration_mode",
      name: "Collaboration mode",
      type: "select",
      currentValue,
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
    });
    await injectEvent(page, {
      type: "session.event",
      session_id: codexSessionId,
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [collaborationOption("plan")],
      },
    });

    await expect(stateSlot).toHaveAttribute(
      "data-session-state-kind",
      "plan_mode",
    );
    await expect(stateSlot).toContainText("Plan");
    await expect(progress).toHaveAttribute("data-progress-kind", "goal");
    await expect(progress).toContainText("Keep the migration moving");
    await capture("plan-mode-slot.png", "shared Plan Mode composer slot");

    await injectEvent(page, {
      type: "session.event",
      session_id: codexSessionId,
      turn_id: "",
      event: {
        sessionUpdate: "config_option_update",
        configOptions: [collaborationOption("default")],
      },
    });
    await expect(stateSlot).toHaveAttribute("data-session-state-kind", "goal");
    await expect(stateSlot).toContainText("Goal");
    await expect(progress).toContainText("Keep the migration moving");
  });

  test("renders the floating progress surface opaque over the transcript", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: { objective: "Stay readable over the feed", status: "active" },
          },
        },
      },
    });

    const progress = page.locator('[data-composer-progress="true"]');
    await expect(progress).toBeVisible();

    // This row floats over scrolling content, so any transparency in it shows
    // the transcript through the words. Read what the browser composited rather
    // than the class list, and read alpha out of whatever colour syntax the
    // palette produced: a fractional utility compiles to rgba(), rgb(… / …) or
    // oklab(… / …) depending on the theme, and a check that knows only one of
    // those reports every translucent surface as solid.
    const surfaces = await progress.evaluate((root) => {
      const alphaOf = (color: string): number => {
        if (!color || color === "transparent") return 0;
        const slash = /\/\s*([0-9.]+%?)\s*\)/u.exec(color);
        if (slash) {
          const raw = slash[1]!;
          return raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
        }
        const commas = /^rgba?\(([^)]+)\)$/u.exec(color);
        if (commas) {
          const parts = commas[1]!.split(",").map((part) => part.trim());
          if (parts.length > 3) return Number(parts[3]);
        }
        return 1;
      };
      const painted: Array<{ role: string; background: string; alpha: number }> = [];
      for (const element of [root, ...root.querySelectorAll("*")]) {
        const el = element as HTMLElement;
        const background = getComputedStyle(el).backgroundColor;
        const alpha = alphaOf(background);
        if (alpha > 0) {
          painted.push({
            role: el.hasAttribute("data-progress-banner")
              ? "banner"
              : el.tagName.toLowerCase(),
            background,
            alpha,
          });
        }
      }
      return painted;
    });

    // The row carrying the words has to be one of the surfaces measured, or this
    // would pass by inspecting an empty wrapper.
    expect(surfaces.some((surface) => surface.role === "banner")).toBe(true);
    expect(surfaces.filter((surface) => surface.alpha < 1)).toEqual([]);
  });

  test("stacks visible queue rows above Goal with Goal attached to the composer", async ({
    page,
    capture,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(async () => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: {
          ...current.appearance,
          theme: "dark",
          language: "zh-CN",
        },
      });
    });
    await expect(page.locator("html")).toHaveClass(/dark/);
    // This row asserts the Steer action, which only exists for a session that
    // negotiated steering — so the fixture has to say so.
    const sessionId = await injectSession(page, {
      agentId: "codex-acp",
      supportsSteering: true,
    });

    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: {
              objective: "Keep Goal below the queue",
              status: "active",
            },
          },
        },
      },
    });
    await injectEvent(page, {
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: "turn-active",
      queued: [
        {
          turn_id: "turn-queued",
          text: "Queued visual check",
          created_at: 1,
        },
      ],
    });

    const capViewport = page.locator('[data-progress-cap-viewport="true"]');
    const queue = page.locator('[data-composer-queue="true"]');
    const queueRow = page.locator('[data-queued-turn-id="turn-queued"]');
    const queueText = queueRow.getByText("Queued visual check", { exact: true });
    const steerButton = queueRow.locator('[data-queue-steer="true"]');
    const goalRow = page.locator('[data-progress-cap-content="true"]');
    const composer = page.locator(".composer-card");

    await expect(queue).toBeVisible();
    await expect(queueRow).toBeVisible();
    await expect(queueText).toBeVisible();
    await expect(steerButton).toBeVisible();
    await expect(goalRow).toBeVisible();
    await expect(goalRow).toContainText("Keep Goal below the queue");

    const capBox = await capViewport.boundingBox();
    const queueBox = await queueRow.boundingBox();
    const queueTextBox = await queueText.boundingBox();
    const goalBox = await goalRow.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(capBox).not.toBeNull();
    expect(queueBox).not.toBeNull();
    expect(queueTextBox).not.toBeNull();
    expect(goalBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(capBox!.height).toBeCloseTo(72, 0);
    expect(queueTextBox!.height).toBeGreaterThan(0);
    expect(queueBox!.y).toBeLessThan(goalBox!.y);
    expect(
      Math.abs(queueBox!.y + queueBox!.height - goalBox!.y),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(goalBox!.y + goalBox!.height - composerBox!.y),
    ).toBeLessThanOrEqual(1);

    await capture("goal-with-queue.png", "Queue above Goal composer cap");
  });

  test("removes a completed Goal from the composer while its result remains in the feed", async ({
    page,
  }) => {
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    const turnId = "turn-completed-goal";
    const objective = "Finish the Goal lifecycle";
    const result = "Goal completed: the lifecycle fix is ready.";

    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: { objective, status: "active" },
          },
        },
      },
    });
    await expect(page.locator('[data-composer-progress="true"]')).toContainText(
      objective,
    );

    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: result },
      },
    });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: {
              objective,
              status: "completed",
              timeUsedSeconds: 72,
            },
          },
        },
      },
    });
    await injectEvent(page, {
      type: "session.complete",
      session_id: sessionId,
      turn_id: turnId,
    });

    await expect(page.getByText(result, { exact: true })).toBeVisible();
    await expect(page.locator('[data-composer-progress="true"]')).toHaveCount(0);
    await expect(page.locator('[data-composer-session-state="true"]')).toHaveCount(0);
  });

  test("keeps Goal progress separate from an ACP task list", async ({
    page,
    bridge,
    capture,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(async () => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: {
          ...current.appearance,
          theme: "dark",
          language: "en",
        },
      });
    });
    await expect(page.locator("html")).toHaveClass(/dark/);

    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    const turnId = "turn-goal-plan";
    await injectAvailableCommands(page, sessionId, [
      {
        name: "goal",
        description: "Manage the active Goal",
        input: { hint: "pause | resume" },
      },
    ]);
    const closeSidePanel = page.getByRole("button", {
      name: "Close side panel",
    });
    if (await closeSidePanel.isVisible()) {
      await closeSidePanel.click();
      await expect(closeSidePanel).toBeHidden();
    }

    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: {
              objective: "Ship unified goal progress",
              status: "active",
              tokenBudget: 40_000,
            },
          },
        },
      },
    });
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Inspect goal and plan events",
            priority: "high",
            status: "completed",
          },
          {
            content: "Build the shared Plan GUI",
            priority: "high",
            status: "in_progress",
          },
          {
            content: "Verify the Electron surface",
            priority: "medium",
            status: "pending",
          },
        ],
      },
    });

    const progress = page.locator('[data-composer-progress="true"]');
    const stepTrigger = page.locator('[data-progress-step-trigger="true"]');
    const capViewport = page.locator('[data-progress-cap-viewport="true"]');
    const goalBanner = page.locator('[data-progress-banner="true"]');
    const taskList = page.locator('[data-plan-activity="true"]');
    const goalIcon = goalBanner.locator(".lucide-target");
    const goalLabel = goalBanner.getByText("Pursuing goal", { exact: true });
    const goalTitle = goalBanner.getByText("Ship unified goal progress", {
      exact: true,
    });
    const goalDismiss = goalBanner.getByRole("button", {
      name: "Dismiss progress",
    });
    const composer = page.locator(".composer-card");
    await expect(progress).toBeVisible();
    await expect(stepTrigger).toHaveCount(0);
    await expect(goalBanner).toBeVisible();
    await expect(progress).toHaveAttribute("data-progress-kind", "goal");
    await expect(progress).toHaveAttribute("data-goal-status", "active");
    await expect(progress).toHaveAttribute("data-current-item", "0");
    await expect(progress).toContainText("Ship unified goal progress");
    await expect(progress).not.toContainText("Step 2 / 3");
    await expect(taskList).toBeVisible();
    await expect(taskList).toContainText("1 / 3");
    const capBox = await capViewport.boundingBox();
    const bannerBox = await goalBanner.boundingBox();
    const iconBox = await goalIcon.boundingBox();
    const labelBox = await goalLabel.boundingBox();
    const dismissBox = await goalDismiss.boundingBox();
    const composerBox = await composer.boundingBox();
    const composerRadius = await composer.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
    );
    expect(capBox).not.toBeNull();
    expect(bannerBox).not.toBeNull();
    expect(iconBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(dismissBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    const goalLabelType = await goalLabel.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: Number(style.fontWeight),
      };
    });
    const goalTitleType = await goalTitle.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    });
    const taskListType = await taskList.locator("button").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      };
    });
    expect(goalLabelType).toEqual({
      fontSize: "14px",
      lineHeight: "20px",
      fontWeight: 600,
    });
    expect(goalTitleType).toEqual({
      fontSize: "14px",
      lineHeight: "20px",
    });
    expect(taskListType).toEqual({
      fontSize: "14px",
      lineHeight: "20px",
    });
    expect(bannerBox!.height).toBeGreaterThanOrEqual(48);
    expect(bannerBox!.height).toBeLessThanOrEqual(60);
    expect(
      Math.abs(bannerBox!.x - composerBox!.x - composerRadius),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        composerBox!.x +
          composerBox!.width -
          (bannerBox!.x + bannerBox!.width) -
          composerRadius,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(capViewport).toHaveCSS("overflow", "hidden");
    expect(capBox!.height).toBeLessThan(bannerBox!.height);
    expect(
      Math.abs(capBox!.y + capBox!.height - composerBox!.y),
    ).toBeLessThanOrEqual(0.5);
    expect(bannerBox!.y).toBeLessThan(composerBox!.y);
    expect(bannerBox!.y + bannerBox!.height).toBeGreaterThan(composerBox!.y);
    const visibleCapCenter = bannerBox!.y + (composerBox!.y - bannerBox!.y) / 2;
    expect(
      Math.abs(iconBox!.y + iconBox!.height / 2 - visibleCapCenter),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(labelBox!.y + labelBox!.height / 2 - visibleCapCenter),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(dismissBox!.y + dismissBox!.height / 2 - visibleCapCenter),
    ).toBeLessThanOrEqual(1);
    const capScreenshotPath = await capture(
      "goal-cap.png",
      "goal cap above composer",
    );
    const capFocusTop = Math.max(0, bannerBox!.y - 24);
    const capFocusLeft = Math.max(0, composerBox!.x - 24);
    await page.screenshot({
      path: capScreenshotPath.replace(".png", "-focus.png"),
      clip: {
        x: capFocusLeft,
        y: capFocusTop,
        width: Math.min(1600 - capFocusLeft, composerBox!.width + 48),
        height: Math.min(
          1000 - capFocusTop,
          composerBox!.y + composerBox!.height + 24 - capFocusTop,
        ),
      },
    });

    const pauseButton = goalBanner.getByRole("button", {
      name: "Pause progress",
    });
    await expect(pauseButton).toBeEnabled();
    await pauseButton.click();
    await expect
      .poll(async () => bridge.readSessionCommands())
      .toEqual([
        {
          session_id: sessionId,
          command: "goal",
          args: "pause",
        },
      ]);

    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: {
        sessionUpdate: "session_info_update",
        _meta: {
          codex: {
            goal: {
              objective: "Ship unified goal progress",
              status: "paused",
              tokenBudget: 40_000,
            },
          },
        },
      },
    });
    await expect(progress).toHaveAttribute("data-goal-status", "paused");
    const resumeButton = goalBanner.getByRole("button", {
      name: "Resume progress",
    });
    await expect(resumeButton).toBeEnabled();
    await resumeButton.click();
    await expect
      .poll(async () => bridge.readSessionCommands())
      .toEqual([
        {
          session_id: sessionId,
          command: "goal",
          args: "pause",
        },
        {
          session_id: sessionId,
          command: "goal",
          args: "resume",
        },
      ]);

    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Inspect goal and plan events",
            priority: "high",
            status: "completed",
          },
          {
            content: "Build the shared Plan GUI",
            priority: "high",
            status: "completed",
          },
          {
            content: "Verify the Electron surface",
            priority: "medium",
            status: "in_progress",
          },
        ],
      },
    });

    await expect(progress).toHaveAttribute("data-current-item", "0");
    await expect(progress).not.toContainText("Step 3 / 3");
    await expect(taskList).toContainText("2 / 3");

    await page.getByRole("button", { name: "Dismiss progress" }).click();
    await expect(progress).toBeHidden();

    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Inspect goal and plan events",
            status: "completed",
          },
          {
            content: "Build the shared Plan GUI",
            status: "completed",
          },
          {
            content: "Verify the Electron surface",
            status: "completed",
          },
        ],
      },
    });
    await expect(progress).toBeHidden();
    await expect(taskList).toBeVisible();
    await expect(taskList).toContainText("3 / 3");
  });
});
