import { describe, expect, it, vi } from "vitest";

import { bindBrowserViewRegistration } from "./browser-view-registration";

class FakeBrowserView {
  readonly listeners = new Map<string, Set<EventListener>>();
  webContentsId = 42;
  available = true;

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({} as Event);
    }
  }

  getWebContentsId(): number {
    if (!this.available) throw new Error("Guest is not ready");
    return this.webContentsId;
  }
}

describe("bindBrowserViewRegistration", () => {
  it("registers the current guest immediately", async () => {
    const webview = new FakeBrowserView();
    const register = vi.fn().mockResolvedValue(undefined);
    const onRegistered = vi.fn();

    bindBrowserViewRegistration(webview, {
      sessionId: "session-1",
      tabId: "tab-1",
      getActive: () => true,
      register,
      unregister: vi.fn().mockResolvedValue(undefined),
      onRegistered,
    });

    expect(register).toHaveBeenCalledWith({
      sessionId: "session-1",
      tabId: "tab-1",
      webContentsId: 42,
      active: true,
    });
    await vi.waitFor(() => {
      expect(onRegistered).toHaveBeenCalledWith(42);
    });
  });

  it("registers on DOM ready when the guest was initially unavailable", async () => {
    const webview = new FakeBrowserView();
    webview.available = false;
    const register = vi.fn().mockResolvedValue(undefined);

    bindBrowserViewRegistration(webview, {
      sessionId: "session-1",
      tabId: "tab-1",
      getActive: () => false,
      register,
      unregister: vi.fn().mockResolvedValue(undefined),
      onRegistered: vi.fn(),
    });
    expect(register).not.toHaveBeenCalled();

    webview.available = true;
    webview.emit("dom-ready");

    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledWith({
        sessionId: "session-1",
        tabId: "tab-1",
        webContentsId: 42,
        active: false,
      });
    });
  });

  it("does not duplicate a pending registration", () => {
    const webview = new FakeBrowserView();
    const register = vi.fn(
      () => new Promise<void>(() => undefined),
    );

    bindBrowserViewRegistration(webview, {
      sessionId: "session-1",
      tabId: "tab-1",
      getActive: () => true,
      register,
      unregister: vi.fn().mockResolvedValue(undefined),
      onRegistered: vi.fn(),
    });
    webview.emit("dom-ready");
    webview.emit("dom-ready");

    expect(register).toHaveBeenCalledOnce();
  });

  it("does not repeat a completed registration for the same guest", async () => {
    const webview = new FakeBrowserView();
    const register = vi.fn().mockResolvedValue(undefined);
    const onRegistered = vi.fn();

    bindBrowserViewRegistration(webview, {
      sessionId: "session-1",
      tabId: "tab-1",
      getActive: () => true,
      register,
      unregister: vi.fn().mockResolvedValue(undefined),
      onRegistered,
    });
    await vi.waitFor(() => {
      expect(onRegistered).toHaveBeenCalledWith(42);
    });
    webview.emit("dom-ready");

    expect(register).toHaveBeenCalledOnce();
  });

  it("retries when the guest id is not ready yet", async () => {
    vi.useFakeTimers();
    try {
      const webview = new FakeBrowserView();
      webview.available = false;
      const register = vi.fn().mockResolvedValue(undefined);

      bindBrowserViewRegistration(webview, {
        sessionId: "session-1",
        tabId: "tab-1",
        getActive: () => true,
        register,
        unregister: vi.fn().mockResolvedValue(undefined),
        onRegistered: vi.fn(),
      });
      webview.available = true;

      await vi.advanceTimersByTimeAsync(25);

      expect(register).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("unregisters a completed guest when disposed", async () => {
    const webview = new FakeBrowserView();
    const unregister = vi.fn().mockResolvedValue(undefined);
    const onRegistered = vi.fn();
    const dispose = bindBrowserViewRegistration(webview, {
      sessionId: "session-1",
      tabId: "tab-1",
      getActive: () => true,
      register: vi.fn().mockResolvedValue(undefined),
      unregister,
      onRegistered,
    });
    await vi.waitFor(() => {
      expect(onRegistered).toHaveBeenCalledWith(42);
    });

    dispose();

    expect(unregister).toHaveBeenCalledWith({
      sessionId: "session-1",
      tabId: "tab-1",
      webContentsId: 42,
    });
    expect(onRegistered).toHaveBeenLastCalledWith(null);
    expect([...(webview.listeners.get("dom-ready") ?? [])]).toHaveLength(0);
  });

  it("unregisters a pending guest if registration finishes after disposal", async () => {
    const webview = new FakeBrowserView();
    let finishRegistration: (() => void) | undefined;
    const register = vi.fn(
      () => new Promise<void>((resolve) => {
        finishRegistration = resolve;
      }),
    );
    const unregister = vi.fn().mockResolvedValue(undefined);
    const onRegistered = vi.fn();
    const dispose = bindBrowserViewRegistration(webview, {
      sessionId: "session-1",
      tabId: "tab-1",
      getActive: () => true,
      register,
      unregister,
      onRegistered,
    });

    dispose();
    finishRegistration?.();
    await vi.waitFor(() => {
      expect(unregister).toHaveBeenCalledWith({
        sessionId: "session-1",
        tabId: "tab-1",
        webContentsId: 42,
      });
    });
    expect(onRegistered).not.toHaveBeenCalledWith(42);
  });

  it("activates a guest that became active while registration was pending", async () => {
    const webview = new FakeBrowserView();
    let active = false;
    let finishRegistration: (() => void) | undefined;
    const register = vi.fn(
      () => new Promise<void>((resolve) => {
        finishRegistration = resolve;
      }),
    );
    const setActive = vi.fn().mockResolvedValue(undefined);
    bindBrowserViewRegistration(webview, {
      sessionId: "session-1",
      tabId: "tab-1",
      getActive: () => active,
      register,
      unregister: vi.fn().mockResolvedValue(undefined),
      setActive,
      onRegistered: vi.fn(),
    });

    active = true;
    finishRegistration?.();

    await vi.waitFor(() => {
      expect(setActive).toHaveBeenCalledWith({
        sessionId: "session-1",
        tabId: "tab-1",
        webContentsId: 42,
      });
    });
  });
});
