import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ShellLayout route chrome", () => {
  it("does not reserve the chat topbar row on non-chat surfaces", () => {
    const shell = readFileSync(resolve(__dirname, "AppShell.tsx"), "utf8");

    expect(shell).toContain("const hasTopbar = topbar != null;");
    expect(shell).toContain("{hasTopbar && (");
    expect(shell).toContain('paddingTop: hasTopbar ? undefined : "var(--stage-inset)"');
  });

  it("mounts side chat, terminal, and their buttons only on chat routes", () => {
    const layout = readFileSync(resolve(__dirname, "ShellLayout.tsx"), "utf8");
    const shell = readFileSync(resolve(__dirname, "AppShell.tsx"), "utf8");

    expect(layout).toContain("rightPanel={isChat ? <SideChatPanel /> : undefined}");
    expect(layout).toContain("bottomPanel={isChat ? <BottomPanel /> : undefined}");
    expect(shell).toContain("if (!isChatRoute) return null;");
  });
});
