import { expect, test } from "@playwright/test";
import { closeApp, launchApp } from "./helpers";

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
  test("keeps ACP auth setup semantics aligned in the GUI", async () => {
    const { app, page } = await launchApp();
    try {
      await page.evaluate(async (fixture) => {
        // @ts-expect-error — test bridge typed in preload/index.ts
        await window.__backchatTest.setAgentSetupFixture(fixture);
      }, {
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
      await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Back to app" })).toBeVisible();
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
      await expect.poll(async () => page.evaluate(() => {
        // @ts-expect-error — test bridge typed in preload/index.ts
        return window.__backchatTest.agentSetupCalls();
      })).toContainEqual({ type: "auth", id: "multi-agent", methodId: "terminal-login" });

      await page.getByRole("button", { name: "Sign in to Waiting Agent" }).click();
      await expect(page.getByText("Set up Waiting Agent")).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByText("Waiting for auth")).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue sign in" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Check now" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Check Waiting Agent auth again" })).toBeVisible();
      await expect(page.getByText("Auth configured")).toBeVisible({ timeout: 8_000 });
    } finally {
      await closeApp(app);
    }
  });
});
