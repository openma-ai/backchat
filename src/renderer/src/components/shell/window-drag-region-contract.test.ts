import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shellDir = resolve(__dirname);

function read(name: string): string {
  return readFileSync(resolve(shellDir, name), "utf8");
}

describe("window title bar drag region", () => {
  const css = readFileSync(
    resolve(shellDir, "../../styles/index.css"),
    "utf8",
  );

  it("marks the shell header as the macOS drag region", () => {
    const shell = read("AppShell.tsx");
    expect(shell).toContain('data-window-titlebar="true"');
    expect(shell).toContain('!rightExpanded && "app-drag-region"');
    const main = readFileSync(resolve(shellDir, "../../../../main/index.ts"), "utf8");
    expect(main).toContain('process.platform === "darwin"');
    expect(main).toContain('"hiddenInset"');
    expect(main).toContain('process.env["BACKCHAT_E2E_HIDDEN_TITLEBAR"] === "1"');
    expect(main).toContain("testHooksEnabled &&");
  });

  it("uses Electron drag and no-drag, including the unprefixed property", () => {
    expect(css).toContain(".app-drag-region {");
    expect(css).toContain("-webkit-app-region: drag;");
    expect(css).toContain("app-region: drag;");
    expect(css).toContain(".app-no-drag {");
    expect(css).toContain("-webkit-app-region: no-drag;");
    expect(css).toContain("app-region: no-drag;");
  });

  it("keeps a no-drag title wrapper draggable and controls clickable", () => {
    expect(css).toContain("header.app-drag-region .app-no-drag {");
    const controls = css.slice(css.indexOf("header.app-drag-region :is("));
    expect(controls).toContain("button,");
    expect(controls).toContain('[role="button"]');
    expect(controls).toContain("-webkit-app-region: no-drag !important;");
    expect(controls).toContain("app-region: no-drag !important;");
  });

  it("does not leave a drag title under the expanded panel, and lets panel chrome blanks drag", () => {
    expect(css).toContain("header:not(.app-drag-region) .app-drag-region {");
    expect(css).toContain("[data-panel-titlebar] {");
    const panelRule = css.slice(css.indexOf("[data-panel-titlebar] :is("));
    expect(panelRule).toContain("button,");
    expect(panelRule).toContain('[role="tab"]');
    expect(panelRule).toContain("-webkit-app-region: no-drag !important;");
    const panel = read("SideChatPanel.tsx");
    expect(panel).toContain('data-panel-titlebar="true"');
    expect(panel).toContain(
      "app-drag-region pointer-events-auto shrink-0 flex h-[var(--top-row-h)]",
    );
    expect(panel).toContain('data-pinned-main-session="true"');
    const pinned = panel.slice(
      panel.indexOf('data-pinned-main-session="true"'),
      panel.indexOf('data-pinned-main-session="true"') + 280,
    );
    expect(pinned).toContain("app-no-drag");
  });

  it("keeps the chats compose icon as the new-conversation action", () => {
    const sidebar = read("Sidebar.tsx");
    expect(sidebar).toContain('aria-label={t("sidebar.newConversation")}');
    expect(sidebar).toContain("const newConversationAction = (");
    expect(sidebar).toContain("action={newConversationAction}");
    expect(sidebar).toContain('data-testid="new-chat-button"');
    const action = sidebar.slice(
      sidebar.indexOf("const newConversationAction = ("),
      sidebar.indexOf("const newConversationAction = (") + 400,
    );
    expect(action).toContain("onClick={goHome}");
    const newChat = sidebar.slice(
      sidebar.indexOf('data-testid="new-chat-button"'),
      sidebar.indexOf('data-testid="new-chat-button"') + 200,
    );
    expect(newChat).toContain("onClick={goHome}");
  });
});
