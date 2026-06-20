import { describe, expect, it } from "vitest";
import { computeClosedPetBounds, computeEventPanelLayout } from "./event-panel-layout";

const display = { x: 0, y: 0, width: 1440, height: 900 };
const pet = { width: 112, height: 128 };

describe("event panel layout", () => {
  it("keeps a left-edge pet anchored when the panel opens to the right", () => {
    const layout = computeEventPanelLayout({ x: 8, y: 420, ...pet }, display);

    expect(layout.side).toBe("right");
    expect(layout.bounds.x + layout.pet.left).toBe(8);
    expect(layout.bounds.y + layout.pet.top).toBe(420);
    expect(layout.panel.left).toBeGreaterThan(layout.pet.left + pet.width);
  });

  it("keeps a right-edge pet anchored when the panel opens to the left", () => {
    const layout = computeEventPanelLayout({ x: 1300, y: 420, ...pet }, display);

    expect(layout.side).toBe("left");
    expect(layout.bounds.x + layout.pet.left).toBe(1300);
    expect(layout.panel.left).toBe(20);
  });

  it("clamps the expanded window but preserves the pet screen position", () => {
    const layout = computeEventPanelLayout({ x: 1300, y: 820, ...pet }, display);

    expect(layout.bounds.y + layout.pet.top).toBe(820);
    expect(layout.bounds.y + layout.bounds.height).toBeLessThanOrEqual(900);
  });

  it.each([
    ["top-left", { x: 0, y: 0, ...pet }],
    ["left-bottom", { x: 0, y: 772, ...pet }],
    ["right-top", { x: 1328, y: 0, ...pet }],
    ["right-bottom", { x: 1328, y: 772, ...pet }],
    ["bottom-center", { x: 664, y: 772, ...pet }],
  ])("keeps the pet anchored and all panel controls visible at %s", (_name, petBounds) => {
    const layout = computeEventPanelLayout(petBounds, display);

    expect(computeClosedPetBounds(layout)).toEqual(petBounds);
    expect(layout.bounds.x).toBeGreaterThanOrEqual(display.x);
    expect(layout.bounds.y).toBeGreaterThanOrEqual(display.y);
    expect(layout.bounds.x + layout.bounds.width).toBeLessThanOrEqual(display.x + display.width);
    expect(layout.bounds.y + layout.bounds.height).toBeLessThanOrEqual(display.y + display.height);
    expect(layout.panel.left).toBeGreaterThanOrEqual(20);
    expect(layout.panel.top).toBeGreaterThanOrEqual(20);
    expect(layout.panel.left + layout.panel.width).toBeLessThanOrEqual(layout.bounds.width - 20);
    expect(layout.panel.top + layout.panel.height + 44).toBeLessThanOrEqual(layout.bounds.height);
  });

  it("opens the panel away from a side-peek pet without covering the visible strip", () => {
    const leftPeek = computeEventPanelLayout({ x: 0, y: 260, width: 48, height: 128 }, display);
    const rightPeek = computeEventPanelLayout({ x: 1392, y: 260, width: 48, height: 128 }, display);

    expect(leftPeek.side).toBe("right");
    expect(leftPeek.panel.left).toBeGreaterThan(leftPeek.pet.left + leftPeek.pet.width);
    expect(rightPeek.side).toBe("left");
    expect(rightPeek.panel.left + rightPeek.panel.width).toBeLessThan(rightPeek.pet.left);
  });
});
