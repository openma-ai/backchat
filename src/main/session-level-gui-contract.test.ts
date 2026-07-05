import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("session level GUI contract", () => {
  it("does not expose native subagent creation from the right rail", () => {
    const sidePanelSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/SideChatPanel.tsx",
      ),
      "utf-8",
    );

    expect(sidePanelSource).toContain('label: "Side chat"');
    expect(sidePanelSource).toContain('sessionStore.newSideDraft({');
    expect(sidePanelSource).toContain('openSideTab("chat"');
    expect(sidePanelSource).not.toContain('onPickSubagent');
    expect(sidePanelSource).not.toContain('newSideSubagentDraft');
    expect(sidePanelSource).not.toContain('继承子任务');
    expect(sidePanelSource).not.toContain('派发当前线程的任务');
  });

  it("starts side chats through the side-parent fork path", () => {
    const sidePanelSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/SideChatPanel.tsx",
      ),
      "utf-8",
    );
    const chatViewSource = readFileSync(
      resolve(__dirname, "../renderer/src/components/chat/ChatView.tsx"),
      "utf-8",
    );

    expect(sidePanelSource).toContain("const canForkSideChat");
    expect(sidePanelSource).toContain('const inheritance = canForkSideChat ? "fork" : "fresh"');
    expect(sidePanelSource).toContain("parentSessionId: mainActive.id");
    expect(sidePanelSource).toContain("parentAcpSessionId: canForkSideChat");
    expect(chatViewSource).toContain("const parentLink = target.sideParent ?? target.subagent");
    expect(chatViewSource).toContain("parentLink?.inheritance === \"fork\"");
    expect(chatViewSource).toContain("fork,");
  });

  it("keeps native subagent detection scoped to runtime events", () => {
    const storeSource = readFileSync(
      resolve(__dirname, "../renderer/src/lib/session-store.ts"),
      "utf-8",
    );
    const nativeSource = readFileSync(
      resolve(__dirname, "../renderer/src/lib/native-agent-events.ts"),
      "utf-8",
    );

    expect(storeSource).toContain("nativeProviderForAgent");
    expect(storeSource).toContain('normalized === "codex-acp"');
    expect(storeSource).toContain('normalized === "claude-acp"');
    expect(nativeSource).toContain('name === "spawn_agent"');
    expect(nativeSource).toContain('name === "task" || name === "agent"');
    expect(nativeSource).not.toContain("agentId:");
  });
});
