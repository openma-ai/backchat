import { afterEach, describe, expect, it, vi } from "vitest";

import * as utils from "./utils";
import { SCROLL_ANCHOR_ESCAPE_BUFFER_PX } from "./utils";

describe("preserveScrollAnchor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps a clicked disclosure trigger at the same viewport position", () => {
    const preserveScrollAnchor = (
      utils as typeof utils & {
        preserveScrollAnchor?: (options: {
          scrollElement: { scrollTop: number } | null;
          anchorElement: {
            getBoundingClientRect: () => { top: number };
          } | null;
          contentElement?: object | null;
          update: () => void;
          stopScroll: () => void;
          scheduleFrame: (callback: () => void) => void;
        }) => void;
      }
    ).preserveScrollAnchor;

    expect(preserveScrollAnchor).toBeTypeOf("function");
    if (!preserveScrollAnchor) return;

    const scrollElement = { scrollTop: 240 };
    const stopScroll = vi.fn();
    const update = vi.fn();
    const tops = [120, 84];
    const anchorElement = {
      getBoundingClientRect: () => ({ top: tops.shift()! }),
    };

    preserveScrollAnchor({
      scrollElement,
      anchorElement,
      update,
      stopScroll,
      scheduleFrame: (callback) => callback(),
    });

    expect(stopScroll).toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    expect(scrollElement.scrollTop).toBe(204);
  });

  it("reanchors after each resize stage of a collapsing disclosure", () => {
    const preserveScrollAnchor = (
      utils as typeof utils & {
        preserveScrollAnchor: (options: {
          scrollElement: { scrollTop: number };
          anchorElement: {
            getBoundingClientRect: () => { top: number };
          };
          contentElement: object;
          update: () => void;
          stopScroll: () => void;
          scheduleFrame: (callback: () => void) => void;
        }) => void;
      }
    ).preserveScrollAnchor;
    const frames: Array<() => void> = [];
    let onResize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );

    const scrollElement = { scrollTop: 240 };
    let documentTop = 360;
    const stopScroll = vi.fn();
    preserveScrollAnchor({
      scrollElement,
      anchorElement: {
        getBoundingClientRect: () => ({
          top: documentTop - scrollElement.scrollTop,
        }),
      },
      contentElement: {},
      update: () => {
        documentTop = 330;
      },
      stopScroll,
      scheduleFrame: (callback) => frames.push(callback),
    });

    expect(onResize).toBeTypeOf("function");
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(scrollElement.scrollTop).toBe(210);

    documentTop = 300;
    onResize!();
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(scrollElement.scrollTop).toBe(180);
    expect(stopScroll.mock.calls.length).toBeGreaterThanOrEqual(2);

    vi.unstubAllGlobals();
  });

  it("adds only the missing bottom scroll range when collapse hits the limit", () => {
    const preserveScrollAnchor = (
      utils as typeof utils & {
        preserveScrollAnchor: (options: {
          scrollElement: object;
          anchorElement: {
            getBoundingClientRect: () => { top: number };
          };
          contentElement: object;
          update: () => void;
          stopScroll: () => void;
          scheduleFrame: (callback: () => void) => void;
        }) => void;
      }
    ).preserveScrollAnchor;
    const frames: Array<() => void> = [];
    const scrollListeners = new Set<() => void>();
    let baseMaxScrollTop = 240;
    let bottomSlack = 0;
    let currentScrollTop = 240;
    let inlinePaddingBottom = "";
    const scrollElement = {
      clientHeight: 600,
      get scrollHeight() {
        return 600 + baseMaxScrollTop + bottomSlack;
      },
      get scrollTop() {
        return currentScrollTop;
      },
      set scrollTop(value: number) {
        currentScrollTop = Math.max(
          0,
          Math.min(value, baseMaxScrollTop + bottomSlack),
        );
      },
      addEventListener: (_type: string, listener: () => void) =>
        scrollListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        scrollListeners.delete(listener),
    };
    const contentElement = {
      style: {
        get paddingBottom() {
          return inlinePaddingBottom;
        },
        set paddingBottom(value: string) {
          inlinePaddingBottom = value;
          bottomSlack = Math.max(0, Number.parseFloat(value || "24") - 24);
        },
      },
    };
    vi.stubGlobal("getComputedStyle", () => ({ paddingBottom: "24px" }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    preserveScrollAnchor({
      scrollElement,
      anchorElement: {
        getBoundingClientRect: () => ({ top: 360 - currentScrollTop }),
      },
      contentElement,
      update: () => {
        baseMaxScrollTop = 180;
        scrollElement.scrollTop = currentScrollTop;
      },
      stopScroll: vi.fn(),
      scheduleFrame: (callback) => frames.push(callback),
    });

    frames.shift()!();
    expect(currentScrollTop).toBe(240);
    // needed (60) + escape buffer (71)
    expect(bottomSlack).toBe(60 + SCROLL_ANCHOR_ESCAPE_BUFFER_PX);
    expect(inlinePaddingBottom).toBe(`${24 + 60 + SCROLL_ANCHOR_ESCAPE_BUFFER_PX}px`);
    // Stay outside stick-to-bottom's near-bottom band while the session is live.
    expect(
      scrollElement.scrollHeight - scrollElement.clientHeight - currentScrollTop,
    ).toBeGreaterThan(70);

    scrollElement.scrollTop = 210;
    scrollListeners.forEach((listener) => listener());
    expect(bottomSlack).toBe(30 + SCROLL_ANCHOR_ESCAPE_BUFFER_PX);
    expect(currentScrollTop).toBe(210);

    scrollElement.scrollTop = 180;
    scrollListeners.forEach((listener) => listener());
    // contentNeeded → 0, escape buffer still held for the session.
    expect(bottomSlack).toBe(SCROLL_ANCHOR_ESCAPE_BUFFER_PX);
    expect(currentScrollTop).toBe(180);
  });

  it("clears the escape buffer when the preserve session ends", () => {
    vi.useFakeTimers();
    const frames: Array<() => void> = [];
    let baseMaxScrollTop = 240;
    let bottomSlack = 0;
    let currentScrollTop = 240;
    let inlinePaddingBottom = "";
    const scrollElement = {
      clientHeight: 600,
      get scrollHeight() {
        return 600 + baseMaxScrollTop + bottomSlack;
      },
      get scrollTop() {
        return currentScrollTop;
      },
      set scrollTop(value: number) {
        currentScrollTop = Math.max(
          0,
          Math.min(value, baseMaxScrollTop + bottomSlack),
        );
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const contentElement = {
      style: {
        get paddingBottom() {
          return inlinePaddingBottom;
        },
        set paddingBottom(value: string) {
          inlinePaddingBottom = value;
          bottomSlack = Math.max(0, Number.parseFloat(value || "24") - 24);
        },
      },
    };
    vi.stubGlobal("getComputedStyle", () => ({ paddingBottom: "24px" }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    utils.preserveScrollAnchor({
      scrollElement,
      anchorElement: {
        getBoundingClientRect: () => ({ top: 360 - currentScrollTop }),
      },
      contentElement: contentElement as unknown as HTMLElement,
      update: () => {
        baseMaxScrollTop = 180;
        scrollElement.scrollTop = currentScrollTop;
      },
      stopScroll: vi.fn(),
      scheduleFrame: (callback) => frames.push(callback),
    });
    frames.shift()!();
    expect(bottomSlack).toBe(60 + SCROLL_ANCHOR_ESCAPE_BUFFER_PX);

    vi.advanceTimersByTime(400);
    // Session end strips the escape buffer; contentNeeded remains 60 while
    // scrollTop is still past the real max.
    expect(bottomSlack).toBe(60);
    expect(currentScrollTop).toBe(240);
  });

  it("does not let a stale disclosure observer undo a newer toggle", () => {
    const resizeCallbacks: Array<() => void> = [];
    const disconnects: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        #callback: () => void;
        constructor(callback: () => void) {
          this.#callback = callback;
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {
          disconnects.push(this.#callback);
        }
      },
    );

    let contentTop = 100;
    const scheduled: Array<() => void> = [];
    const scrollElement = {
      scrollTop: 100,
      scrollHeight: 1_000,
      clientHeight: 400,
      addEventListener() {},
      removeEventListener() {},
    };
    const anchorElement = {
      getBoundingClientRect: () =>
        ({ top: contentTop - scrollElement.scrollTop }) as DOMRect,
    };
    const contentElement = {
      style: { paddingBottom: "" },
    } as unknown as HTMLElement;
    const scheduleFrame = (callback: () => void) => scheduled.push(callback);
    const runScheduledFrames = () => {
      while (scheduled.length > 0) scheduled.shift()?.();
    };

    utils.preserveScrollAnchor({
      scrollElement,
      anchorElement,
      contentElement,
      update: () => {
        contentTop = 120;
      },
      stopScroll: () => {},
      scheduleFrame,
    });
    utils.preserveScrollAnchor({
      scrollElement,
      anchorElement,
      contentElement,
      update: () => {
        contentTop = 100;
      },
      stopScroll: () => {},
      scheduleFrame,
    });
    runScheduledFrames();

    expect(anchorElement.getBoundingClientRect().top).toBe(20);

    // Stale first observer must be a no-op after the newer toggle.
    resizeCallbacks[0]?.();
    runScheduledFrames();

    expect(anchorElement.getBoundingClientRect().top).toBe(20);
  });
});
