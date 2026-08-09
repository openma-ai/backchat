import { expect, test } from "./fixtures";
import { injectSession } from "./helpers";

const envAgent = {
  id: "env-agent",
  label: "Env Agent",
  command: "env-agent",
  detected: true,
  available: true,
  installed: true,
  auth: {
    status: "needs-auth",
    message: "Missing credential variable: OPENAI_API_KEY.",
    methodId: "openai-key",
    methodName: "OpenAI API key",
    methods: [{
      id: "openai-key",
      name: "OpenAI API key",
      type: "env_var",
      vars: [{ name: "OPENAI_API_KEY", secret: true }],
    }],
  },
};

const terminalAgent = {
  id: "terminal-agent",
  label: "Terminal Agent",
  command: "terminal-agent",
  detected: true,
  available: true,
  installed: true,
  auth: {
    status: "needs-auth",
    message: "Open terminal setup.",
    methodId: "terminal-login",
    methodName: "Terminal login",
    methods: [{ id: "terminal-login", name: "Terminal login", type: "terminal" }],
  },
};

const multiAgent = {
  id: "multi-agent",
  label: "Multi Agent",
  command: "multi-agent",
  detected: true,
  available: true,
  installed: true,
  auth: {
    status: "needs-auth",
    message: "Choose an auth method.",
    methodId: "browser-login",
    methodName: "Browser login",
    methods: [
      { id: "browser-login", name: "Browser login", type: "agent" },
      { id: "terminal-login", name: "Terminal login", type: "terminal" },
    ],
  },
};

const waitingAgentNeedsAuth = {
  id: "waiting-agent",
  label: "Waiting Agent",
  command: "waiting-agent",
  detected: true,
  available: true,
  installed: true,
  auth: {
    status: "needs-auth",
    message: "Sign in first.",
    methodId: "login",
    methodName: "Login",
    methods: [{ id: "login", name: "Login", type: "agent" }],
  },
};

const waitingAgentConfigured = {
  ...waitingAgentNeedsAuth,
  auth: {
    status: "configured",
    message: "ACP auth is configured.",
    methodId: "login",
    methodName: "Login",
    methods: [{ id: "login", name: "Login", type: "agent" }],
  },
};

test.describe("settings agent setup lifecycle", () => {
  test("keeps ACP auth setup semantics aligned in the GUI", async ({ page, bridge }) => {
      await bridge.setAgentSetupFixture({
        agents: [envAgent, terminalAgent, multiAgent, waitingAgentNeedsAuth],
        authenticateResults: {
          "multi-agent": [envAgent, terminalAgent, multiAgent, waitingAgentNeedsAuth],
          "waiting-agent": [envAgent, terminalAgent, multiAgent, waitingAgentNeedsAuth],
        },
        probeResults: {
          "waiting-agent": [envAgent, terminalAgent, multiAgent, waitingAgentConfigured],
        },
      });

      await page.getByRole("link", { name: "Settings" }).click();
      await page.getByRole("link", { name: "Agents", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to app" })).toBeVisible();
      await expect(page.getByPlaceholder("Search settings...")).toBeVisible();
      await expect(page.getByText("Personal")).toBeVisible();
      await expect(page.getByText("Integrations")).toBeVisible();
      await expect(page.getByRole("button", { name: "New chat", exact: true })).toHaveCount(0);

      await expect(page.getByRole("button", { name: "Configure Env Agent credentials" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open Terminal Agent setup" })).toBeVisible();

      await page.getByRole("button", { name: "Sign in to Multi Agent" }).click();
      await expect(page.getByText("Set up Multi Agent")).toBeVisible();
      await page.getByRole("radio", { name: /Terminal login/ }).click();
      await page.getByRole("button", { name: "Open terminal setup" }).click();
      await expect.poll(() => bridge.readAgentSetupCalls())
        .toContainEqual({ type: "auth", id: "multi-agent", methodId: "terminal-login" });

      await page.getByRole("button", { name: "Sign in to Waiting Agent" }).click();
      await expect(page.getByText("Set up Waiting Agent")).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByText("Waiting for auth")).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue sign in" })).toBeVisible();
  });

  test("shows a managed ACP update and restarts the current task process", async ({ page }) => {
    const sessionId = await injectSession(page, {
      agentId: "update-agent",
      cwd: "/tmp/backchat-update-test",
    });
    const updateAgent = {
      id: "update-agent",
      label: "Update Agent",
      command: "update-agent",
      detected: true,
      available: true,
      installed: true,
      installedVersion: "2.0.0",
      latestVersion: "2.0.0",
      updateAvailable: true,
    };
    await page.evaluate(async ({ fixture, sessionId }) => {
      // @ts-expect-error — test bridge typed in preload/index.ts
      await window.__backchatTest.setAgentSetupFixture({
        agents: [fixture],
        runtimeStatuses: {
          [sessionId]: {
            session_id: sessionId,
            agent_id: fixture.id,
            running_version: "1.0.0",
            installed_version: "2.0.0",
            restart_required: true,
            busy: false,
            restart_pending: false,
          },
        },
        upgradeResults: {
          [fixture.id]: [{ ...fixture, updateAvailable: false }],
        },
      });
      const settings = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        agents: [
          ...settings.agents.filter((agent) => agent.id !== fixture.id),
          { id: fixture.id, enabled: true, env: [] },
        ],
      });
    }, { fixture: updateAgent, sessionId });

    // Visiting Agent settings refreshes the shared setup snapshot before the
    // sidebar exposes the direct-update control.
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("link", { name: "Agents", exact: true }).click();
    await page.getByRole("button", { name: "Back to app" }).click();
    await expect(page.locator('[data-chat-surface="main"]')).toBeVisible();

    const updateControl = page.getByRole("button", { name: "1 ACP update available" });
    await expect(updateControl).toBeVisible();
    await updateControl.click();
    const updateDialog = page.getByRole("dialog", { name: "ACP updates" });
    await expect(updateDialog).toBeVisible();
    await updateDialog.getByRole("button", { name: "Update Update Agent" }).click();
    await expect(updateDialog.getByRole("status"))
      .toContainText("Update Agent updated to 2.0.0");
    await page.keyboard.press("Escape");
    await expect(updateDialog).toBeHidden();

    const composer = page.locator('[data-chat-column="composer"]');
    await expect(composer.getByText("ACP update installed")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "ACP update installed — restart required" }),
    ).toBeVisible();

    const updateToast = page.locator(
      '[data-sonner-toaster][data-y-position="top"][data-x-position="right"] [data-sonner-toast]',
    ).filter({ hasText: "ACP update installed" });
    await expect(updateToast).toBeVisible();
    await expect(updateToast.getByText("1.0.0 → 2.0.0")).toBeVisible();
    await updateToast.getByRole("button", { name: "Restart ACP" }).click();
    await expect(
      page.getByRole("button", { name: "ACP update installed — restart required" }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: "ACP restarted" }),
    ).toBeVisible();
  });
});
