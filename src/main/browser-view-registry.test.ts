import { describe, expect, it, vi } from "vitest";

import {
  BrowserViewRegistry,
  type BrowserViewTarget,
} from "./browser-view-registry";

function target(id: number, url: string): BrowserViewTarget {
  return {
    id,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => `Tab ${id}`,
    loadURL: vi.fn(async () => undefined),
    executeJavaScript: vi.fn(async () => undefined),
    capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from("png") })),
  };
}

describe("BrowserViewRegistry", () => {
  it("tracks several live tabs per chat and resolves the active one", () => {
    const registry = new BrowserViewRegistry();
    const first = target(11, "https://one.example");
    const second = target(12, "https://two.example");

    registry.register({
      sessionId: "session-1",
      tabId: "tab-one",
      hostWebContentsId: 7,
      target: first,
      active: true,
    });
    registry.register({
      sessionId: "session-1",
      tabId: "tab-two",
      hostWebContentsId: 7,
      target: second,
      active: false,
    });

    expect(registry.list("session-1")).toEqual([
      expect.objectContaining({ tabId: "tab-one", active: true, target: first }),
      expect.objectContaining({ tabId: "tab-two", active: false, target: second }),
    ]);
    expect(registry.active("session-1")?.target).toBe(first);

    registry.setActive("session-1", "tab-two", 7);

    expect(registry.active("session-1")?.target).toBe(second);
    expect(registry.list("session-1").map((entry) => [entry.tabId, entry.active])).toEqual([
      ["tab-one", false],
      ["tab-two", true],
    ]);
  });

  it("ignores a stale unregister from a replaced WebView", () => {
    const registry = new BrowserViewRegistry();
    const stale = target(21, "https://old.example");
    const current = target(22, "https://new.example");

    registry.register({
      sessionId: "session-1",
      tabId: "tab-one",
      hostWebContentsId: 7,
      target: stale,
      active: true,
    });
    registry.register({
      sessionId: "session-1",
      tabId: "tab-one",
      hostWebContentsId: 7,
      target: current,
      active: true,
    });

    registry.unregister("session-1", "tab-one", stale.id, 7);

    expect(registry.active("session-1")?.target).toBe(current);
  });

  it("waits for a UI-created tab to register", async () => {
    vi.useFakeTimers();
    const registry = new BrowserViewRegistry();
    const pending = registry.waitFor("session-1", "tab-later", 1_000);
    const later = target(31, "https://later.example");

    registry.register({
      sessionId: "session-1",
      tabId: "tab-later",
      hostWebContentsId: 7,
      target: later,
      active: true,
    });

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ tabId: "tab-later", target: later }),
    );
    vi.useRealTimers();
  });

  it("waits for a renderer-closed tab to unregister", async () => {
    const registry = new BrowserViewRegistry();
    registry.register({
      sessionId: "session-1",
      tabId: "tab-closing",
      hostWebContentsId: 7,
      target: target(35, "https://closing.example"),
      active: true,
    });

    const closed = registry.waitForMissing("session-1", "tab-closing", 1_000);
    registry.unregister("session-1", "tab-closing", 35, 7);

    await expect(closed).resolves.toBeUndefined();
  });

  it("rejects cross-window activation and unregister attempts", () => {
    const registry = new BrowserViewRegistry();
    registry.register({
      sessionId: "session-1",
      tabId: "tab-one",
      hostWebContentsId: 7,
      target: target(41, "https://one.example"),
      active: true,
    });

    expect(() => registry.setActive("session-1", "tab-one", 99)).toThrow(
      "Browser tab does not belong to this window",
    );
    expect(() => registry.unregister("session-1", "tab-one", 41, 99)).toThrow(
      "Browser tab does not belong to this window",
    );
  });
});
