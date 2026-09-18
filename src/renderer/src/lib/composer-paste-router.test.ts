import { describe, expect, it, vi } from "vitest";

import {
  createComposerPasteRouter,
  isEditableEventTarget,
  type PasteRouterEvent,
} from "./composer-paste-router";

function fakeDocument() {
  const listeners = new Set<(event: PasteRouterEvent) => void>();
  return {
    listeners,
    addEventListener: vi.fn((_type: "paste", listener: (event: PasteRouterEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: "paste", listener: (event: PasteRouterEvent) => void) => {
      listeners.delete(listener);
    }),
    paste(overrides: Partial<PasteRouterEvent> = {}) {
      const event: PasteRouterEvent = {
        target: { tagName: "BODY" },
        defaultPrevented: false,
        clipboardData: { types: ["Files"] },
        preventDefault: () => undefined,
        ...overrides,
      };
      for (const listener of listeners) listener(event);
      return event;
    },
  };
}

describe("isEditableEventTarget", () => {
  it("treats form fields and contenteditable hosts as owning their own paste", () => {
    expect(isEditableEventTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableEventTarget({ tagName: "input" })).toBe(true);
    expect(isEditableEventTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableEventTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("leaves everything else to the composer", () => {
    expect(isEditableEventTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableEventTarget({ tagName: "BODY", isContentEditable: false })).toBe(false);
    expect(isEditableEventTarget(null)).toBe(false);
    expect(isEditableEventTarget(undefined)).toBe(false);
  });
});

describe("createComposerPasteRouter", () => {
  it("listens on the document only while a composer is registered", () => {
    const doc = fakeDocument();
    const router = createComposerPasteRouter(doc);

    expect(doc.addEventListener).not.toHaveBeenCalled();
    const first = router.register(() => undefined);
    const second = router.register(() => undefined);
    expect(doc.addEventListener).toHaveBeenCalledTimes(1);

    first.unregister();
    expect(doc.removeEventListener).not.toHaveBeenCalled();
    second.unregister();
    expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
    expect(doc.listeners.size).toBe(0);
  });

  it("routes a paste that landed outside any editable element to the last focused composer", () => {
    const doc = fakeDocument();
    const router = createComposerPasteRouter(doc);
    const main = vi.fn();
    const side = vi.fn();
    const mainRegistration = router.register(main);
    router.register(side);

    // Nothing has claimed focus yet: the most recently mounted composer wins.
    doc.paste();
    expect(side).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();

    mainRegistration.noteFocus();
    const event = doc.paste();
    expect(main).toHaveBeenCalledTimes(1);
    expect(main).toHaveBeenCalledWith(event.clipboardData, event);
    expect(side).toHaveBeenCalledTimes(1);
  });

  it("falls back once the focused composer unmounts", () => {
    const doc = fakeDocument();
    const router = createComposerPasteRouter(doc);
    const main = vi.fn();
    const side = vi.fn();
    const mainRegistration = router.register(main);
    router.register(side);
    mainRegistration.noteFocus();
    mainRegistration.unregister();

    doc.paste();
    expect(side).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled();
  });

  it("does not steal a paste from a focused field or one already handled", () => {
    const doc = fakeDocument();
    const router = createComposerPasteRouter(doc);
    const handler = vi.fn();
    router.register(handler);

    doc.paste({ target: { tagName: "TEXTAREA" } });
    doc.paste({ target: { tagName: "DIV", isContentEditable: true } });
    doc.paste({ defaultPrevented: true });
    doc.paste({ clipboardData: null });

    expect(handler).not.toHaveBeenCalled();
  });

  it("is inert without a document", () => {
    const router = createComposerPasteRouter(null);
    const registration = router.register(() => undefined);
    registration.noteFocus();
    expect(() => registration.unregister()).not.toThrow();
  });
});
