import { expect, test } from "./fixtures";
import {
  enableAgent,
  injectEvent,
  injectSession,
  reloadRenderer,
} from "./helpers";

async function useEnglish(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, language: "en" },
    });
  });
  await reloadRenderer(page);
}

test.describe("GUI bugfix batch evidence", () => {
  test.beforeEach(async ({ page }) => {
    await useEnglish(page);
  });

  test("session.error clears the active turn and re-enables the composer", async ({
    page,
    capture,
  }) => {
    await enableAgent(page, "codex-acp");
    const sessionId = await injectSession(page, { agentId: "codex-acp" });
    const turnId = "turn-error-stop";
    await injectEvent(page, {
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Working…" },
      },
    });
    await injectEvent(page, {
      type: "session.queue_update",
      session_id: sessionId,
      mode: "single",
      active_turn_id: turnId,
      queued: [],
    });
    await injectEvent(page, {
      type: "session.error",
      session_id: sessionId,
      message: "Provider disconnected",
    });
    await expect(
      page.locator('[data-slot="status-notice"][data-tone="danger"]').filter({
        hasText: "Provider disconnected",
      }),
    ).toBeVisible();
    const composer = page.locator('[data-chat-surface="main"] textarea').last();
    await composer.fill("typed after session.error");
    await expect(composer).toHaveValue("typed after session.error");
    await capture("gui-bugfix-session-error-timer.png", "composer after session.error");
  });

  test("side chat launcher shows the fresh-thread hint when fork is unavailable", async ({
    page,
    capture,
  }) => {
    await enableAgent(page, "dsh-acp");
    await injectSession(page, {
      sessionId: "e2e-side-hint",
      agentId: "dsh-acp",
      supportsSessionFork: false,
      forkSupport: {
        level: "none",
        reason: "message-fork-not-advertised",
        message: "Fork disabled for this fixture.",
      },
    });
    await page.getByRole("button", { name: "Open side panel" }).click();
    const freshHint = page.getByText("Start a separate side thread", { exact: true });
    await expect(freshHint).toBeVisible();
    await expect(page.getByText("Fork the current context", { exact: true })).toHaveCount(0);
    await capture("gui-bugfix-side-chat-fresh-hint.png", "side chat fresh hint");
  });

  test("external source tooltip stays inside the viewport", async ({
    page,
    capture,
  }) => {
    await enableAgent(page, "codex-acp");
    await page.setViewportSize({ width: 1280, height: 520 });
    await injectSession(page, {
      sessionId: "e2e-external-badge",
      agentId: "codex-acp",
      externalClient: "cursor killer",
    });
    const badge = page.getByTestId("external-source-badge").first();
    await badge.scrollIntoViewIfNeeded();
    await badge.hover();
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toContainText("Started by cursor killer");
    const box = await tooltip.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(4);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - 4);
    await capture("gui-bugfix-started-by-tooltip.png", "started by tooltip");
  });

  test("CLI-persisted user prompt appears after opening the chat", async ({
    page,
    bridge,
    capture,
  }) => {
    await enableAgent(page, "codex-acp");
    const sessionId = "e2e-cli-prompt-gui";
    await bridge.persistSessionFixture({
      sessionId,
      agentId: "codex-acp",
      cwd: "/tmp/backchat-cli-prompt",
      acpSessionId: "acp-cli-prompt",
      title: "CLI started thread",
      events: [{ type: "user_prompt", data: { text: "hello from CLI" } }],
    });
    await injectEvent(page, {
      type: "session.prompt",
      session_id: sessionId,
      turn_id: "cli-live-head",
      text: "",
    });
    await injectSession(page, {
      sessionId,
      agentId: "codex-acp",
      cwd: "/tmp/backchat-cli-prompt",
    });
    await expect(page.getByText("hello from CLI", { exact: true })).toBeVisible();
    await capture("gui-bugfix-cli-prompt.png", "CLI prompt in GUI");
  });
});
