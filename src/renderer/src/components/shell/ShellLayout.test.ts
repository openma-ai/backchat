import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { getHistoryNavigationState } from "./AppShell";

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

    expect(layout).toContain(
      "rightPanel={hasTaskChrome ? <SideChatPanel /> : undefined}",
    );
    expect(layout).toContain(
      "bottomPanel={hasTaskChrome ? <BottomPanel /> : undefined}",
    );
    expect(layout).toContain("const hasTaskChrome = isChat && hasEnabledAgent;");
    expect(shell).toContain("if (!isChatRoute) return null;");
  });

  it("places persistent back and forward navigation beside the traffic-light controls", () => {
    const shell = readFileSync(resolve(__dirname, "AppShell.tsx"), "utf8");
    const history = createMemoryHistory({
      initialEntries: ["/", "/settings/activity"],
    });

    expect(shell).toContain("<GlobalHistoryControls />");
    expect(shell).toContain("router.history.back()");
    expect(shell).toContain("router.history.forward()");
    expect(getHistoryNavigationState(history)).toEqual({
      canGoBack: true,
      canGoForward: false,
    });

    history.back();
    expect(history.location.pathname).toBe("/");
    expect(getHistoryNavigationState(history)).toEqual({
      canGoBack: false,
      canGoForward: true,
    });
  });
});
