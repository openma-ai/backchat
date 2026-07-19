import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(__dirname, path), "utf8");
}

describe("agent and session lifecycle contract", () => {
  it("keeps probe, install, and update work out of real session start", () => {
    const manager = source("session-manager.ts");

    expect(manager).not.toContain("probeAgentAuthStatus");
    expect(manager).not.toContain("ensureLatestAcpBinary");
    expect(manager).not.toContain("installAcpRegistryAgent");
    expect(manager).not.toContain("setDefaultAgent");
  });

  it("treats cold-start warmup as a single readiness barrier", () => {
    const ipc = source("ipc.ts");
    const listHandler = ipc.slice(
      ipc.indexOf("InvokeChannel.AgentsList"),
      ipc.indexOf("InvokeChannel.AgentInstall"),
    );

    expect(ipc).toContain("const agentWarmup = agentSetup.warmup()");
    expect(listHandler).toContain("await agentWarmup");
  });

  it("allows full probes only for manual refresh and post-install/update", () => {
    const settings = source("../renderer/src/pages/settings/Agents.tsx");
    const setup = source("../../packages/acp-agent-setup/src/index.ts");
    const sharedApi = source("../shared/api.ts");
    const authBranch = setup.slice(
      setup.lastIndexOf("  async authenticateAgent("),
      setup.indexOf("private async refreshRegistry("),
    );

    expect(settings).toContain('input.type === "refresh"');
    expect(settings).toContain("agentsList({ refresh: true })");
    expect(settings).toContain('agentsList({ readiness: "snapshot" })');
    expect(settings).not.toContain("probeAgentIds:");
    expect(setup).toContain("async refreshEnabledAgents()");
    expect(settings).not.toContain("agentProbe(");
    expect(setup).toContain('capabilities: { target: "detected" }');
    expect(setup).toContain('capabilities: { target: "ids", ids: enabledAgentIds }');
    expect(setup).toContain('capabilities: { target: "ids", ids: [id] }');
    expect(authBranch).not.toContain("capabilities:");
    expect(sharedApi).not.toContain("probeAgentIds");
    expect(sharedApi).not.toContain("probeConfigOptions");
  });

  it("requires explicit recent-run selection instead of a static default", () => {
    const harness = source("../renderer/src/lib/composer-harness-state.ts");
    const settingsPage = source("../renderer/src/pages/settings/Agents.tsx");
    const manager = source("session-manager.ts");
    const settingsSchema = source("settings-store.ts");
    const sharedSettings = source("../shared/settings.ts");

    expect(harness).toContain("recentPreferences.agentId");
    expect(harness).not.toContain("default.agent_id");
    expect(settingsPage).not.toContain("Default agent");
    expect(manager).toContain('const requestedAgentId = p.agent_id || ""');
    expect(settingsSchema).toContain("hasDeprecatedAgentDefault");
    expect(sharedSettings).not.toContain("agent_id:");
  });

  it("uses a structured start result instead of push-event timing", () => {
    const submission = source("../renderer/src/lib/chat-submission.ts");
    const manager = source("session-manager.ts");

    expect(submission).toContain('startResult.status !== "ready"');
    expect(submission).not.toContain('status === "errored"');
    expect(manager).toContain("Promise<SessionStartResult>");
  });

  it("coalesces starts and makes disposal dominate late lifecycle events", () => {
    const manager = source("session-manager.ts");

    expect(manager).toContain("#starting = new Map");
    expect(manager).toContain("#cancelledStarts = new Set");
    expect(manager).toContain("if (sess.disposed) return");
    expect(manager).toContain("sess.queuedPrompts = []");
  });

  it("disposes real ACP processes during the app shutdown barrier", () => {
    const index = source("index.ts");
    const ipc = source("ipc.ts");

    expect(index).toContain("ipcRuntime.dispose()");
    expect(index).toContain("event.preventDefault()");
    expect(index).toContain("shutdownBarrierStarted");
    expect(ipc).toContain("sessionManager.disposeAll()");
    expect(ipc).toContain("agentSetup.dispose()");
  });
});
