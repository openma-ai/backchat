import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

describe("ACP background process GUI contract", () => {
  it("exposes live ACP terminals to the renderer without conflating them with UI terminals", () => {
    const channels = source("../shared/ipc-channels.ts");
    const api = source("../shared/api.ts");
    const preload = source("../preload/index.ts");
    const ipc = source("./ipc.ts");
    const brokers = source("./brokers.ts");

    expect(channels).toContain('AcpTerminalsList: "acpTerminals:list"');
    expect(channels).toContain('AcpTerminalSnapshot: "acpTerminal:snapshot"');
    expect(channels).toContain('AcpTerminalKill: "acpTerminal:kill"');
    expect(api).toContain("acpTerminalsList(");
    expect(api).toContain("acpTerminalSnapshot(");
    expect(api).toContain("acpTerminalKill(");
    expect(preload).toContain("acpTerminalsList:");
    expect(preload).toContain("acpTerminalSnapshot:");
    expect(preload).toContain("acpTerminalKill:");
    expect(ipc).toContain("InvokeChannel.AcpTerminalsList");
    expect(ipc).toContain("InvokeChannel.AcpTerminalSnapshot");
    expect(ipc).toContain("InvokeChannel.AcpTerminalKill");
    expect(brokers).toContain("export function listTerminals");
  });

  it("renders ACP terminal output in a dedicated right-panel tab", () => {
    const panel = source("../renderer/src/components/shell/SideChatPanel.tsx");
    const processTab = source("../renderer/src/components/shell/BackgroundProcessTab.tsx");

    expect(panel).toContain('type === "process"');
    expect(panel).toContain("<BackgroundProcessTab");
    expect(processTab).toContain("window.backchat.acpTerminalSnapshot");
    expect(processTab).toContain("window.backchat.onTerminalOutput");
    expect(processTab).toContain("window.backchat.acpTerminalKill");
  });
});
