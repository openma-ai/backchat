import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOVER_INTENT_REST_MS,
  HOVER_INTENT_WARM_MS,
  HOVER_INTENT_WARM_WINDOW_MS,
  createHoverIntent,
} from "./sidebar-hover-intent";

describe("sidebar hover intent", () => {
  let opened: Array<string | null>;
  const make = () => createHoverIntent({ onChange: (key) => opened.push(key) });

  beforeEach(() => {
    vi.useFakeTimers();
    opened = [];
  });
  afterEach(() => vi.useRealTimers());

  it("does not open while the pointer is travelling across rows", () => {
    const intent = make();
    // A sweep down the list: a new row every 60ms, never resting.
    for (let i = 0; i < 20; i++) {
      intent.move({ key: `row-${i}`, x: 40, y: 10 + i * 28, mouse: true });
      vi.advanceTimersByTime(60);
    }
    expect(opened).toEqual([]);
  });

  it("opens only after the pointer rests on one row", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS - 1);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual(["row-a"]);
  });

  it("restarts the rest timer while the pointer keeps moving on the row", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS - 100);
    intent.move({ key: "row-a", x: 60, y: 12, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS - 100);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(opened).toEqual(["row-a"]);
  });

  it("ignores rows that slide under a still pointer while the list scrolls", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    intent.scroll();
    // Chromium re-dispatches pointer events at the same coordinates as
    // content scrolls underneath; those are not the user's intent.
    intent.move({ key: "row-b", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS * 2);
    expect(opened).toEqual([]);
    // A real move afterwards counts again.
    intent.move({ key: "row-b", x: 41, y: 11, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    expect(opened).toEqual(["row-b"]);
  });

  it("closes at once when the list scrolls", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    intent.scroll();
    expect(opened).toEqual(["row-a", null]);
  });

  it("stays shut after a click on the row until the pointer leaves it", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    intent.press();
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS * 2);
    intent.move({ key: "row-a", x: 45, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS * 2);
    expect(opened).toEqual([]);
    intent.move({ key: "row-b", x: 45, y: 40, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    expect(opened).toEqual(["row-b"]);
  });

  it("closes an open card when the row is pressed", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    intent.press();
    expect(opened).toEqual(["row-a", null]);
  });

  it("never opens over a row's own action buttons", () => {
    const intent = make();
    intent.move({ key: null, x: 200, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS * 2);
    expect(opened).toEqual([]);
  });

  it("moving onto the actions closes the card", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    intent.move({ key: null, x: 200, y: 10, mouse: true });
    expect(opened).toEqual(["row-a", null]);
  });

  it("ignores touch and pen", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: false });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS * 2);
    expect(opened).toEqual([]);
  });

  it("hands off quickly to a neighbour right after a card was open", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    intent.move({ key: "row-b", x: 40, y: 38, mouse: true });
    expect(opened).toEqual(["row-a", null]);
    vi.advanceTimersByTime(HOVER_INTENT_WARM_MS);
    expect(opened).toEqual(["row-a", null, "row-b"]);
  });

  it("goes cold again once the warm window has passed", () => {
    const intent = make();
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    intent.leave();
    vi.advanceTimersByTime(HOVER_INTENT_WARM_WINDOW_MS + 1);
    intent.move({ key: "row-b", x: 40, y: 38, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_WARM_MS);
    expect(opened).toEqual(["row-a", null]);
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS - HOVER_INTENT_WARM_MS);
    expect(opened).toEqual(["row-a", null, "row-b"]);
  });

  it("does not open while a menu is open", () => {
    let menuOpen = true;
    const intent = createHoverIntent({
      onChange: (key) => opened.push(key),
      blocked: () => menuOpen,
    });
    intent.move({ key: "row-a", x: 40, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS * 2);
    expect(opened).toEqual([]);
    menuOpen = false;
    intent.move({ key: "row-a", x: 42, y: 10, mouse: true });
    vi.advanceTimersByTime(HOVER_INTENT_REST_MS);
    expect(opened).toEqual(["row-a"]);
  });
});
