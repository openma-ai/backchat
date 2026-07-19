import { describe, expect, it, vi } from "vitest";

import * as utils from "./utils";

describe("preserveScrollAnchor", () => {
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

    expect(stopScroll).toHaveBeenCalledOnce();
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
    expect(stopScroll).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });
});
