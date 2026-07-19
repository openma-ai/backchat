import { describe, expect, it, vi } from "vitest";

import {
  applyBrowserFindQuery,
  bindBrowserFindShortcuts,
  clearBrowserFind,
  findNextInBrowser,
} from "./browser-find";

class FakeShortcutTarget {
  readonly listeners = new Set<EventListener>();

  addEventListener(type: string, listener: EventListener): void {
    if (type === "keydown") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === "keydown") this.listeners.delete(listener);
  }

  keydown(input: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
  }) {
    const event = {
      key: input.key,
      metaKey: input.metaKey ?? false,
      ctrlKey: input.ctrlKey ?? false,
      preventDefault: vi.fn(),
    };
    for (const listener of this.listeners) {
      listener(event as unknown as Event);
    }
    return event;
  }
}

function createFindTarget() {
  return {
    findInPage: vi.fn(),
    stopFindInPage: vi.fn(),
  };
}

describe("browser find", () => {
  it("finds a trimmed query and clears selection for blank input", () => {
    const target = createFindTarget();

    applyBrowserFindQuery(target, "  settings  ");
    applyBrowserFindQuery(target, "   ");

    expect(target.findInPage).toHaveBeenCalledWith("settings");
    expect(target.stopFindInPage).toHaveBeenCalledWith("clearSelection");
  });

  it("advances only when the submitted query is non-empty", () => {
    const target = createFindTarget();

    findNextInBrowser(target, "  settings  ");
    findNextInBrowser(target, " ");

    expect(target.findInPage).toHaveBeenCalledOnce();
    expect(target.findInPage).toHaveBeenCalledWith("settings", {
      forward: true,
      findNext: true,
    });
  });

  it("clears the active match explicitly when find closes", () => {
    const target = createFindTarget();

    clearBrowserFind(target);

    expect(target.stopFindInPage).toHaveBeenCalledWith("clearSelection");
  });

  it("binds platform find and conditional Escape shortcuts with cleanup", () => {
    const target = new FakeShortcutTarget();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    let open = false;
    const cleanup = bindBrowserFindShortcuts(target, {
      isOpen: () => open,
      onOpen,
      onClose,
    });

    const openEvent = target.keydown({ key: "F", metaKey: true });
    expect(openEvent.preventDefault).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();

    const closedEscape = target.keydown({ key: "Escape" });
    expect(closedEscape.preventDefault).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    open = true;
    const openEscape = target.keydown({ key: "Escape" });
    expect(openEscape.preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    cleanup();
    target.keydown({ key: "f", ctrlKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
