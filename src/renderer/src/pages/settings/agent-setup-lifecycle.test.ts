import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveAgentSetupState } from "./agent-setup-lifecycle";
import type { AgentInfo } from "@shared/api";

function agent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    id: "qwen-code",
    label: "Qwen Code",
    command: "openma-acp-qwen-code",
    detected: true,
    available: true,
    installed: true,
    installable: true,
    ...overrides,
  };
}

describe("deriveAgentSetupState", () => {
  it("publishes probe results to the composer agent query", () => {
    const source = readFileSync(resolve(__dirname, "Agents.tsx"), "utf8");
    expect(source).toContain('import { AGENTS_QUERY_KEY } from "@/lib/agent-query"');
    expect(source).toContain("queryClient.setQueryData(AGENTS_QUERY_KEY, next)");
  });

  it("routes env-var auth to credential configuration instead of sign-in", () => {
    const state = deriveAgentSetupState(agent({
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
    }));

    expect(state.statusKey).toBe("agents.status.authNeeded");
    expect(state.canEnable).toBe(false);
    expect(state.authAction).toEqual({
      kind: "configure",
      labelKey: "agents.auth.configure",
      ariaLabelKey: "agents.auth.configureAria",
    });
  });

  it("shows a waiting state after external auth has launched", () => {
    const state = deriveAgentSetupState(agent({
      auth: {
        status: "needs-auth",
        message: "Authentication required.",
        methodId: "login",
        methodName: "Login",
        methods: [{ id: "login", name: "Login", type: "agent" }],
      },
    }), { waitingForAuth: true });

    expect(state.statusKey).toBe("agents.status.waitingAuth");
    expect(state.canEnable).toBe(false);
    expect(state.authAction).toEqual({
      kind: "sign-in",
      labelKey: "agents.auth.openAgain",
      ariaLabelKey: "agents.auth.signInAgainAria",
    });
  });

  it("routes terminal auth to setup launch copy instead of sign-in", () => {
    const state = deriveAgentSetupState(agent({
      auth: {
        status: "needs-auth",
        message: "Open the terminal setup flow.",
        methodId: "terminal-login",
        methodName: "Terminal login",
        methods: [{
          id: "terminal-login",
          name: "Terminal login",
          type: "terminal",
        }],
      },
    }));

    expect(state.statusKey).toBe("agents.status.authNeeded");
    expect(state.canEnable).toBe(false);
    expect(state.authAction).toEqual({
      kind: "open-setup",
      labelKey: "agents.auth.openSetup",
      ariaLabelKey: "agents.auth.openSetupAria",
    });
  });

  it("does not default a mixed method list to the terminal login", () => {
    const state = deriveAgentSetupState(agent({
      auth: {
        status: "needs-auth",
        message: "Choose a sign-in path.",
        methodId: "terminal-login",
        methodName: "Terminal login",
        methods: [
          { id: "terminal-login", name: "Terminal login", type: "terminal" },
          { id: "browser-login", name: "Browser login", type: "agent" },
        ],
      },
    }));

    expect(state.authMethod?.id).toBe("browser-login");
    expect(state.authAction.kind).toBe("sign-in");
  });

  it("keeps a saved non-terminal method while sign-in is still required", () => {
    const state = deriveAgentSetupState(agent({
      auth: {
        status: "needs-auth",
        message: "Choose a sign-in path.",
        methodId: "deepseek",
        methods: [
          { id: "anthropic", name: "Anthropic", type: "agent" },
          {
            id: "deepseek",
            name: "DeepSeek",
            type: "agent",
            form: "fields",
            vars: [{ name: "api-key", secret: true }],
          },
        ],
      },
    }));

    expect(state.authMethod?.id).toBe("deepseek");
  });

  it("keeps a configured terminal method that the user already saved", () => {
    const state = deriveAgentSetupState(agent({
      auth: {
        status: "configured",
        message: "Authentication configured.",
        methodId: "terminal-login",
        methods: [
          { id: "browser-login", name: "Browser login", type: "agent" },
          { id: "terminal-login", name: "Terminal login", type: "terminal" },
        ],
      },
    }));

    expect(state.authMethod?.id).toBe("terminal-login");
  });

  it("derives the action from the selected auth method when multiple methods exist", () => {
    const state = deriveAgentSetupState(agent({
      auth: {
        status: "needs-auth",
        message: "Choose a sign-in path.",
        methodId: "browser-login",
        methodName: "Browser login",
        methods: [
          { id: "browser-login", name: "Browser login", type: "agent" },
          { id: "terminal-login", name: "Terminal login", type: "terminal" },
        ],
      },
    }), { selectedMethodId: "terminal-login" } as never);

    expect(state.authAction).toEqual({
      kind: "open-setup",
      labelKey: "agents.auth.openSetup",
      ariaLabelKey: "agents.auth.openSetupAria",
    });
  });

  it("exposes upgrade as the setup action for managed stale installs", () => {
    const state = deriveAgentSetupState(agent({
      auth: undefined,
      updateAvailable: true,
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
    }));

    // Same word as the App update row: "Update available".
    expect(state.statusKey).toBe("update.status.updateAvailable");
    expect(state.versionText).toBe("1.0.0 → 2.0.0");
    expect(state.setupAction).toEqual({ kind: "upgrade", labelKey: "agents.upgrade" });
  });

  it("keeps auth status and still exposes the installed version", () => {
    const state = deriveAgentSetupState(agent({
      installedVersion: "0.4.6",
      auth: {
        status: "configured",
        message: "Authentication configured.",
      },
    }));

    expect(state.statusKey).toBe("agents.status.authConfigured");
    expect(state.versionText).toBe("0.4.6");
  });

  it("shows the installed version beside status instead of burying it in copy", () => {
    const state = deriveAgentSetupState(agent({
      installedVersion: "0.0.33",
    }));

    expect(state.statusKey).toBe("agents.status.installed");
    expect(state.versionText).toBe("0.0.33");
  });
});
