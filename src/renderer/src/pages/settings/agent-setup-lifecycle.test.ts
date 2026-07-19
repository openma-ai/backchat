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
    expect(source).toContain('queryClient.setQueryData(["agents"], next)');
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

    expect(state.statusText).toBe("Auth needed");
    expect(state.canEnable).toBe(false);
    expect(state.authAction).toEqual({
      kind: "configure",
      label: "Configure",
      ariaLabel: "Configure Qwen Code credentials",
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

    expect(state.statusText).toBe("Waiting for auth");
    expect(state.canEnable).toBe(false);
    expect(state.authAction).toEqual({
      kind: "sign-in",
      label: "Open again",
      ariaLabel: "Open Qwen Code sign in again",
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

    expect(state.statusText).toBe("Auth needed");
    expect(state.canEnable).toBe(false);
    expect(state.authAction).toEqual({
      kind: "open-setup",
      label: "Open setup",
      ariaLabel: "Open Qwen Code setup",
    });
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
      label: "Open setup",
      ariaLabel: "Open Qwen Code setup",
    });
  });

  it("exposes upgrade as the setup action for managed stale installs", () => {
    const state = deriveAgentSetupState(agent({
      auth: undefined,
      updateAvailable: true,
      installedVersion: "1.0.0",
      latestVersion: "2.0.0",
    }));

    expect(state.statusText).toBe("Update available");
    expect(state.setupAction).toEqual({ kind: "upgrade", label: "Upgrade" });
  });
});
