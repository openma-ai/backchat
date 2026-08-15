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

  it("keeps scheduled on the same no-topbar chrome as settings", () => {
    const layout = readFileSync(resolve(__dirname, "ShellLayout.tsx"), "utf8");

    expect(layout).not.toContain("isScheduled");
    expect(layout).not.toContain("scheduled-chrome");
    expect(layout).toContain(") : null");
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

describe("right rail visibility is per chat", () => {
  it("does not keep a global stored flag that any auto-open can set", () => {
    const layout = readFileSync(resolve(__dirname, "ShellLayout.tsx"), "utf8");

    // One terminal opened in one chat used to write a single localStorage flag,
    // so every later chat — and every relaunch — started with an empty rail
    // hanging open, with no way back to the default.
    expect(layout).not.toContain("openma:right-rail-collapsed");
    expect(layout).not.toContain("usePersistedCollapse(RIGHT_KEY");

    // Collapse is bucketed by the active chat, like the expansion state.
    expect(layout).toContain("function useRightRailCollapseState(sessionId: string | null)");
    expect(layout).toContain("const collapsed = !openChats.has(bucket);");
    expect(layout).toContain(
      "const rightRailCollapse = useRightRailCollapseState(\n    isChat ? activeSession?.id ?? null : null,\n  );",
    );
    expect(layout).toContain(
      "<RightRailCollapseContext.Provider value={rightRailCollapse}>",
    );
    // Imperative reveals still route through the same per-chat setter.
    expect(layout).toContain("bindRightRailSetter(rightRailCollapse.set)");
  });
});
