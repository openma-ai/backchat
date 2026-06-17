import { describe, expect, it } from "vitest";
import {
  finishPetWindowDrag,
  startPetWindowDrag,
  syncPetWindowState,
  type PetWindowState,
} from "./pet-window-state-machine";

const screenBounds = { x: 0, y: 0, width: 1440, height: 900 };
const workAreaWithBottomDock = { x: 0, y: 25, width: 1440, height: 800 };
const display = { bounds: screenBounds, workArea: workAreaWithBottomDock };
const displayWithPartialBottomDock = {
  ...display,
  dockBounds: { x: 520, y: 825, width: 600, height: 75 },
};
const normal = { width: 112, height: 128 };
const bottom = { width: 112, height: 72 };

describe("pet window state machine", () => {
  it("snaps Dock-surface bottom attachments to the Dock top", () => {
    const result = finishPetWindowDrag(
      { x: 320, y: 689, width: normal.width, height: normal.height },
      display,
    );

    expect(result.state).toEqual({ kind: "attached", attachment: { mode: "bottom", surface: "dock" } });
    expect(result.attachment).toEqual({ mode: "bottom", surface: "dock" });
    expect(result.bounds).toEqual({ x: 320, y: 753, width: bottom.width, height: bottom.height });
  });

  it("detaches from an attached state before dragging", () => {
    const state: PetWindowState = {
      kind: "attached",
      attachment: { mode: "bottom", surface: "dock" },
    };

    const result = startPetWindowDrag(
      state,
      { x: 320, y: 753, width: bottom.width, height: bottom.height },
      display,
    );

    expect(result.state).toEqual({ kind: "dragging" });
    expect(result.attachment).toEqual({ mode: "none", surface: "screen" });
    expect(result.bounds).toEqual({ x: 320, y: 697, width: normal.width, height: normal.height });
  });

  it("does not snap while dragging", () => {
    const result = syncPetWindowState(
      { kind: "dragging" },
      { x: 320, y: 820, width: normal.width, height: normal.height },
      display,
    );

    expect(result).toEqual({
      state: { kind: "dragging" },
      attachment: { mode: "none", surface: "screen" },
      bounds: null,
    });
  });

  it("snaps to the Dock top after dragging deeper inside the Dock box", () => {
    const result = finishPetWindowDrag(
      { x: 820, y: 764, width: normal.width, height: normal.height },
      displayWithPartialBottomDock,
    );

    expect(result.state).toEqual({ kind: "attached", attachment: { mode: "bottom", surface: "dock" } });
    expect(result.attachment).toEqual({ mode: "bottom", surface: "dock" });
    expect(result.bounds).toEqual({ x: 820, y: 753, width: bottom.width, height: bottom.height });
  });

  it("snaps to the physical screen bottom after dragging to the bottom edge outside the Dock box", () => {
    const result = finishPetWindowDrag(
      { x: 180, y: 780, width: normal.width, height: normal.height },
      displayWithPartialBottomDock,
    );

    expect(result.state).toEqual({ kind: "attached", attachment: { mode: "bottom", surface: "screen" } });
    expect(result.attachment).toEqual({ mode: "bottom", surface: "screen" });
    expect(result.bounds).toEqual({ x: 180, y: 828, width: bottom.width, height: bottom.height });
  });

  it("does not snap from the Dock-top hot-zone outside the Dock x-axis range", () => {
    const result = finishPetWindowDrag(
      { x: 180, y: 705, width: normal.width, height: normal.height },
      displayWithPartialBottomDock,
    );

    expect(result.state).toEqual({ kind: "free" });
    expect(result.attachment).toEqual({ mode: "none", surface: "screen" });
    expect(result.bounds).toEqual({ x: 180, y: 705, width: normal.width, height: normal.height });
  });
});
