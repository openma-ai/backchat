import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type AgentAction = {
  type: "install" | "upgrade" | "uninstall" | "auth" | "refresh";
  id?: string;
};

async function loadModule(): Promise<{
  isInstallActionDisabled?: (agentId: string, pending: AgentAction[]) => boolean;
  sortAgentsByInstalling?: <T extends { id: string }>(agents: T[], installingIds: Set<string>) => T[];
}> {
  return import("./agent-action-state").catch(() => ({}));
}

describe("Agent action state", () => {
  it("keeps other Agent install buttons enabled during an install", async () => {
    const { isInstallActionDisabled } = await loadModule();
    const pending: AgentAction[] = [{ type: "install", id: "pi-acp" }];

    expect(isInstallActionDisabled).toBeTypeOf("function");
    expect(isInstallActionDisabled?.("pi-acp", pending)).toBe(true);
    expect(isInstallActionDisabled?.("nova", pending)).toBe(false);
    expect(isInstallActionDisabled?.("nova", [{ type: "refresh" }])).toBe(true);
  });

  it("moves installing Agents to the top without reordering their peers", async () => {
    const { sortAgentsByInstalling } = await loadModule();
    const agents = [{ id: "nova" }, { id: "pi-acp" }, { id: "poolside" }];

    expect(sortAgentsByInstalling).toBeTypeOf("function");
    expect(sortAgentsByInstalling?.(agents, new Set(["pi-acp"]))).toEqual([
      { id: "pi-acp" },
      { id: "nova" },
      { id: "poolside" },
    ]);
  });

  it("wires the per-Agent lock to the Install button", () => {
    const source = readFileSync(resolve(__dirname, "Agents.tsx"), "utf8");
    const rowSource = readFileSync(
      resolve(__dirname, "AgentSettingsRow.tsx"),
      "utf8",
    );
    const installButton = rowSource.slice(
      rowSource.indexOf('setup.setupAction.kind === "install"'),
      rowSource.indexOf('setup.setupAction.kind === "upgrade"'),
    );

    expect(installButton).toContain(
      "disabled={isInstallActionDisabled(agent.id, activeActions)}",
    );
    expect(installButton).not.toContain("disabled={anyPending}");
    expect(source).toContain("let installEnableTail: Promise<void>");
    expect(source).toContain("window.backchat.settingsGet()");
  });

  it("enables a newly installed Agent without assigning a static selection", () => {
    const source = readFileSync(resolve(__dirname, "Agents.tsx"), "utf8");
    const installBranch = source.slice(
      source.indexOf('if (input.type === "install"'),
      source.indexOf('if (input.type === "upgrade"'),
    );

    expect(installBranch).toContain("enableInstalledAgent(input.id)");
    expect(installBranch).not.toContain("agentSetDefault");
  });
});
