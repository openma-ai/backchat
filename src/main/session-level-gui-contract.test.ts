import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("session level GUI contract", () => {
  it("offers current-task subagents in the right-rail tab picker without creating them", () => {
    const sidePanelSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/SideChatPanel.tsx",
      ),
      "utf-8",
    );
    const launcherSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/RightPanelLauncher.tsx",
      ),
      "utf-8",
    );
    const sidePanelUiSource = `${sidePanelSource}\n${launcherSource}`;

    expect(sidePanelUiSource).toContain("selectSubagentsFor");
    expect(sidePanelUiSource).toContain("onPickSubagent");
    expect(sidePanelUiSource).toContain("sessionStore.openSideTabForTask(");
    expect(sidePanelUiSource).not.toContain('newSideSubagentDraft');
    expect(sidePanelUiSource).toContain('t("rightPanel.currentSubagents")');
    expect(sidePanelUiSource).toContain('t("rightPanel.outputs")');
    expect(sidePanelUiSource).toContain('t("rightPanel.backgroundProcesses")');
    expect(sidePanelUiSource).toContain('t("rightPanel.sources")');
    expect(sidePanelUiSource).toContain("data-right-panel-launcher-list");
    expect(sidePanelUiSource).toContain("data-current-subagents");
    expect(sidePanelUiSource).not.toContain("grid grid-cols-2");
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
    const submissionSource = readFileSync(
      resolve(__dirname, "../renderer/src/lib/chat-submission.ts"),
      "utf-8",
    );
    expect(sidePanelSource).toContain("const canForkSideChat");
    expect(sidePanelSource).toContain('const inheritance = canForkSideChat ? "fork" : "fresh"');
    expect(sidePanelSource).toContain("parentSessionId: mainActive.id");
    expect(sidePanelSource).toContain("parentAcpSessionId: canForkSideChat");
    expect(chatViewSource).toContain("useChatSubmission");
    expect(submissionSource).toContain(
      "const parentLink = target.sideParent ?? target.subagent",
    );
    expect(submissionSource).toContain(
      'parentLink?.inheritance === "fork"',
    );
    expect(submissionSource).toContain("fork: resolveChatFork(parentLink)");
  });

  it("renders native subagents through the same conversation view as side chats", () => {
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
    const activityToolGroupSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/ActivityToolGroup.tsx",
      ),
      "utf-8",
    );
    const toolPresentationSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/ToolPresentation.tsx",
      ),
      "utf-8",
    );
    const messageSource = readFileSync(
      resolve(__dirname, "../renderer/src/components/ai-elements/message.tsx"),
      "utf-8",
    );
    const stylesSource = readFileSync(
      resolve(__dirname, "../renderer/src/styles/index.css"),
      "utf-8",
    );

    expect(sidePanelSource).toContain(
      'tab.type === "chat" || tab.type === "subagent"',
    );
    expect(sidePanelSource).toContain('<ChatView key={tab.payload} mode="side" />');
    expect(sidePanelSource).toContain("<SubagentAvatar");
    expect(sidePanelSource).toContain("avatarId={tab.avatarId}");
    expect(activityToolGroupSource).toContain("subagentForToolCall");
    expect(activityToolGroupSource).toContain(
      'import { ToolRow } from "./ToolPresentation"',
    );
    expect(activityToolGroupSource).toContain(
      "subagent={subagentForToolCall(subagents, tool.toolCallId)}",
    );
    expect(toolPresentationSource).toContain("<SubagentAvatar");
    expect(toolPresentationSource).toContain("avatarId={subagent.avatarId}");
    expect(sidePanelSource).not.toContain("SubagentActivityTab");
    expect(sidePanelSource).not.toContain("SubagentActivityList");
    expect(chatViewSource).toContain(
      'const isNativeSubagent = active?.sideKind === "subagent";',
    );
    expect(chatViewSource).toContain("Native subagent is managed by its parent");
    expect(chatViewSource).toContain(
      'data-chat-surface={isSide ? "side" : "main"}',
    );
    expect(messageSource).toMatch(
      /export const MessageContent[\s\S]*?<div\s+data-slot="message-content"/,
    );
    const sideBubbleSelector =
      '[data-chat-surface="side"] .is-user > [data-slot="message-content"]';
    expect(stylesSource).toContain(sideBubbleSelector);
    expect(stylesSource.indexOf(sideBubbleSelector)).toBeGreaterThan(
      stylesSource.indexOf('@import "tailwindcss";'),
    );
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
    const activitySource = readFileSync(
      resolve(__dirname, "../renderer/src/lib/session-native-activity.ts"),
      "utf-8",
    );

    expect(storeSource).toContain("nativeProviderForAgent");
    expect(activitySource).toContain('normalized === "codex-acp"');
    expect(activitySource).toContain('normalized === "claude-acp"');
    expect(nativeSource).toContain('name === "spawn_agent"');
    expect(nativeSource).toContain('name === "task" || name === "agent"');
    expect(nativeSource).not.toContain("agentId:");
  });

  it("keeps every task browser window and its tabs mounted", () => {
    const sidePanelSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/SideChatPanel.tsx",
      ),
      "utf-8",
    );
    const browserTabSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/BrowserTab.tsx",
      ),
      "utf-8",
    );

    expect(sidePanelSource).toContain("selectBrowserWindows");
    expect(sidePanelSource).toContain("browserWindows.flatMap");
    expect(sidePanelSource).toContain("onBrowserToolTabCommand");
    expect(sidePanelSource).toContain("patchSideTabForTask");
    expect(browserTabSource).toContain("bindBrowserViewRegistration");
    expect(browserTabSource).toContain("browserViewSetActive");
  });

  it("keeps the new-tab action outside the horizontally scrolling tab strip", () => {
    const sidePanelSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/SideChatPanel.tsx",
      ),
      "utf-8",
    );
    const scrollStart = sidePanelSource.indexOf("data-side-tab-scroll");
    const actionsStart = sidePanelSource.indexOf("data-side-tab-actions");
    const addButton = sidePanelSource.indexOf("<AddTabButton", actionsStart);

    expect(scrollStart).toBeGreaterThan(-1);
    expect(actionsStart).toBeGreaterThan(scrollStart);
    expect(addButton).toBeGreaterThan(actionsStart);
    expect(sidePanelSource).toContain(
      'data-side-tab-actions className="flex shrink-0 items-center gap-1"',
    );
  });

  it("fades only the tab-strip edges that still have hidden content", () => {
    const sidePanelSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/SideChatPanel.tsx",
      ),
      "utf-8",
    );
    const stylesSource = readFileSync(
      resolve(__dirname, "../renderer/src/styles/index.css"),
      "utf-8",
    );

    expect(sidePanelSource).toContain("const [tabScrollFade, setTabScrollFade]");
    expect(sidePanelSource).toContain("new ResizeObserver(updateTabScrollFade)");
    expect(sidePanelSource).toContain("onScroll={updateTabScrollFade}");
    expect(sidePanelSource).toContain("data-fade-left={tabScrollFade.left}");
    expect(sidePanelSource).toContain("data-fade-right={tabScrollFade.right}");
    expect(stylesSource).toContain(
      '.side-tab-scroll[data-fade-left="true"][data-fade-right="true"]',
    );
    expect(stylesSource).toContain("mask-image: linear-gradient(");
  });

  it("keeps horizontal tab overflow from changing the header height", () => {
    const sidePanelSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/shell/SideChatPanel.tsx",
      ),
      "utf-8",
    );
    const stylesSource = readFileSync(
      resolve(__dirname, "../renderer/src/styles/index.css"),
      "utf-8",
    );

    expect(stylesSource).toContain("scrollbar-width: none");
    expect(stylesSource).toContain(".side-tab-scroll::-webkit-scrollbar");
    expect(stylesSource).toContain("display: none");
    expect(sidePanelSource).not.toContain(
      'className="-mb-3 -ml-3 flex min-w-0 flex-1 items-start gap-1 pl-3"',
    );
    expect(sidePanelSource).not.toContain(
      'className="side-tab-scroll min-w-0 flex-1 overflow-x-auto pb-3"',
    );
  });

  it("anchors both nested activity disclosures while their height changes", () => {
    const reasoningSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/ai-elements/reasoning.tsx",
      ),
      "utf-8",
    );
    const activityGroupSource = readFileSync(
      resolve(
        __dirname,
        "../renderer/src/components/chat/ActivityToolGroup.tsx",
      ),
      "utf-8",
    );

    expect(reasoningSource).toContain("preserveScrollAnchor({");
    expect(activityGroupSource).toContain("preserveScrollAnchor({");
  });
});
