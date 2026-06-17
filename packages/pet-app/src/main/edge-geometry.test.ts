import { describe, expect, it } from "vitest";
import {
  BOTTOM_DOCK_SIZE,
  SIDE_PEEK_SIZE,
  SIDE_TRIGGER_VISIBLE_WIDTH,
  TOP_PEEK_SIZE,
  computeEdgeAttachment,
  computeAttachmentSnappedBounds,
  computeDetachedBounds,
  computeEdgeMode,
  computeSnappedBounds,
  resolveLatchedAttachment,
} from "./edge-geometry";

const screenBounds = { x: 0, y: 0, width: 1440, height: 900 };
const workArea = { x: 0, y: 25, width: 1440, height: 875 };
const workAreaWithLeftDock = { x: 72, y: 25, width: 1368, height: 875 };
const workAreaWithBottomDock = { x: 0, y: 25, width: 1440, height: 800 };
const bottomDockBounds = { x: 520, y: 825, width: 600, height: 75 };
const normalSize = { width: 112, height: 128 };
const peekSize = SIDE_PEEK_SIZE;
const centeredBottomX = (bounds: { x: number; width: number }) =>
  bounds.x + bounds.width / 2 - BOTTOM_DOCK_SIZE.width / 2;

describe("pet edge geometry", () => {
  it("does not enter side peek just because it is near the screen edge", () => {
    expect(
      computeEdgeMode(
        { x: 82, y: 200, width: normalSize.width, height: normalSize.height },
        workArea,
      ),
    ).toBe("none");
    expect(
      computeEdgeMode(
        { x: 1440 - normalSize.width - 82, y: 200, width: normalSize.width, height: normalSize.height },
        workArea,
      ),
    ).toBe("none");
  });

  it("enters side peek only inside a narrow reachable edge strip", () => {
    expect(SIDE_TRIGGER_VISIBLE_WIDTH).toBeLessThan(SIDE_PEEK_SIZE.width);
    expect(
      computeEdgeMode(
        { x: workArea.x + 24, y: 200, width: normalSize.width, height: normalSize.height },
        workArea,
      ),
    ).toBe("left");
    expect(
      computeEdgeMode(
        { x: workArea.x + workArea.width - normalSize.width - 24, y: 200, width: normalSize.width, height: normalSize.height },
        workArea,
      ),
    ).toBe("right");
  });

  it("keeps a fixed visible strip when snapped to a side", () => {
    expect(
      computeSnappedBounds(
        { x: 82, y: 200, width: normalSize.width, height: normalSize.height },
        "left",
        workArea,
      ),
    ).toEqual({ x: 0, y: 200, width: peekSize.width, height: peekSize.height });

    expect(
      computeSnappedBounds(
        { x: 1440 - normalSize.width - 82, y: 200, width: normalSize.width, height: normalSize.height },
        "right",
        workArea,
      ),
    ).toEqual({ x: workArea.width - peekSize.width, y: 200, width: peekSize.width, height: peekSize.height });
  });

  it("snaps to a top dock when pushed into the top strip", () => {
    expect(
      computeEdgeMode(
        { x: 260, y: workArea.y + 20, width: normalSize.width, height: normalSize.height },
        workArea,
      ),
    ).toBe("top");
    expect(
      computeSnappedBounds(
        { x: 260, y: workArea.y + 20, width: normalSize.width, height: normalSize.height },
        "top",
        workArea,
      ),
    ).toEqual({ x: 260, y: workArea.y, width: TOP_PEEK_SIZE.width, height: TOP_PEEK_SIZE.height });
  });

  it("snaps to a bottom dock when pushed into the bottom strip", () => {
    const nearBottom = {
      x: 320,
      y: workArea.y + workArea.height - normalSize.height - 12,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeMode(nearBottom, workArea)).toBe("bottom");
    expect(computeSnappedBounds(nearBottom, "bottom", workArea)).toEqual({
      x: centeredBottomX(nearBottom),
      y: workArea.y + workArea.height - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("uses the Dock top from the bottom hot-zone side of a bottom Dock reserve", () => {
    const nearBottomDock = {
      x: 320,
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - normalSize.height - 8,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeMode(nearBottomDock, workAreaWithBottomDock)).toBe("bottom");
    expect(computeSnappedBounds(nearBottomDock, "bottom", workAreaWithBottomDock)).toEqual({
      x: centeredBottomX(nearBottomDock),
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
    expect(computeEdgeAttachment(nearBottomDock, workAreaWithBottomDock, screenBounds)).toEqual({
      mode: "bottom",
      surface: "dock",
    });
    expect(
      computeAttachmentSnappedBounds(
        nearBottomDock,
        { mode: "bottom", surface: "dock" },
        workAreaWithBottomDock,
        screenBounds,
      ),
    ).toEqual({
      x: centeredBottomX(nearBottomDock),
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("uses the physical screen bottom after entering the bottom Dock reserve outside the Dock box", () => {
    const insideDockReserve = {
      x: 620,
      y: screenBounds.y + screenBounds.height - normalSize.height - 4,
      width: normalSize.width,
      height: normalSize.height,
    };

    expect(computeEdgeAttachment(insideDockReserve, workAreaWithBottomDock, screenBounds)).toEqual({
      mode: "bottom",
      surface: "screen",
    });
    expect(
      computeAttachmentSnappedBounds(
        insideDockReserve,
        { mode: "bottom", surface: "screen" },
        workAreaWithBottomDock,
        screenBounds,
      ).y,
    ).toBe(screenBounds.y + screenBounds.height - BOTTOM_DOCK_SIZE.height);
  });

  it("uses the Dock top inside the Dock box even when the pet center enters the bottom reserve", () => {
    const insideDockReserve = {
      x: 720,
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - normalSize.height / 2 + 8,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeAttachment(insideDockReserve, workAreaWithBottomDock, screenBounds, bottomDockBounds)).toEqual({
      mode: "bottom",
      surface: "dock",
    });
    expect(
      computeAttachmentSnappedBounds(
        insideDockReserve,
        { mode: "bottom", surface: "dock" },
        workAreaWithBottomDock,
        screenBounds,
        bottomDockBounds,
      ),
    ).toEqual({
      x: centeredBottomX(insideDockReserve),
      y: bottomDockBounds.y - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("uses the Dock top when only the pet feet cross the Dock reserve", () => {
    const slightlyCrossingDockTop = {
      x: 320,
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - normalSize.height + 8,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeAttachment(slightlyCrossingDockTop, workAreaWithBottomDock, screenBounds)).toEqual({
      mode: "bottom",
      surface: "dock",
    });
    expect(
      computeAttachmentSnappedBounds(
        slightlyCrossingDockTop,
        { mode: "bottom", surface: "dock" },
        workAreaWithBottomDock,
        screenBounds,
      ).y,
    ).toBe(workAreaWithBottomDock.y + workAreaWithBottomDock.height - BOTTOM_DOCK_SIZE.height);
  });

  it("does not trigger any bottom attachment from the Dock-top hot-zone outside the Dock x-axis range", () => {
    const outsideDockX = {
      x: 180,
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - normalSize.height + 8,
      width: normalSize.width,
      height: normalSize.height,
    };

    expect(computeEdgeAttachment(outsideDockX, workAreaWithBottomDock, screenBounds, bottomDockBounds)).toEqual({
      mode: "none",
      surface: "screen",
    });
  });

  it("uses the physical screen bottom outside the Dock x-axis range after reaching the screen-bottom hot-zone", () => {
    const outsideDockXAtScreenBottom = {
      x: 180,
      y: screenBounds.y + screenBounds.height - normalSize.height + 8,
      width: normalSize.width,
      height: normalSize.height,
    };

    expect(
      computeEdgeAttachment(outsideDockXAtScreenBottom, workAreaWithBottomDock, screenBounds, bottomDockBounds),
    ).toEqual({
      mode: "bottom",
      surface: "screen",
    });
    expect(
      computeAttachmentSnappedBounds(
        outsideDockXAtScreenBottom,
        { mode: "bottom", surface: "screen" },
        workAreaWithBottomDock,
        screenBounds,
        bottomDockBounds,
      ),
    ).toEqual({
      x: centeredBottomX(outsideDockXAtScreenBottom),
      y: screenBounds.y + screenBounds.height - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("uses the screen bottom when the pet center is just outside the Dock x-axis range", () => {
    const justOutsideDockRight = {
      x: bottomDockBounds.x + bottomDockBounds.width - normalSize.width / 2 + 1,
      y: screenBounds.y + screenBounds.height - normalSize.height + 8,
      width: normalSize.width,
      height: normalSize.height,
    };

    expect(computeEdgeAttachment(justOutsideDockRight, workAreaWithBottomDock, screenBounds, bottomDockBounds)).toEqual({
      mode: "bottom",
      surface: "screen",
    });
  });

  it("keeps screen-bottom snapping independent from any Dock box", () => {
    const nearScreenBottom = {
      x: 180,
      y: screenBounds.y + screenBounds.height - normalSize.height + 8,
      width: normalSize.width,
      height: normalSize.height,
    };
    const floatingDockBox = { x: 520, y: 760, width: 600, height: 75 };

    expect(
      computeAttachmentSnappedBounds(
        nearScreenBottom,
        { mode: "bottom", surface: "screen" },
        workAreaWithBottomDock,
        screenBounds,
        floatingDockBox,
      ),
    ).toEqual({
      x: centeredBottomX(nearScreenBottom),
      y: screenBounds.y + screenBounds.height - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("triggers the bottom Dock when the pet is inside the Dock x-axis range", () => {
    const insideDockX = {
      x: 720,
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - normalSize.height + 8,
      width: normalSize.width,
      height: normalSize.height,
    };

    expect(computeEdgeAttachment(insideDockX, workAreaWithBottomDock, screenBounds, bottomDockBounds)).toEqual({
      mode: "bottom",
      surface: "dock",
    });
    expect(
      computeAttachmentSnappedBounds(
        insideDockX,
        { mode: "bottom", surface: "dock" },
        workAreaWithBottomDock,
        screenBounds,
        bottomDockBounds,
      ),
    ).toEqual({
      x: centeredBottomX(insideDockX),
      y: bottomDockBounds.y - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("classifies a physical screen-bottom rest as screen without latch context", () => {
    const snappedToScreenBottom = {
      x: 320,
      y: screenBounds.y + screenBounds.height - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    };
    expect(computeEdgeAttachment(snappedToScreenBottom, workAreaWithBottomDock, screenBounds)).toEqual({
      mode: "bottom",
      surface: "screen",
    });
  });

  it("keeps a latched Dock attachment instead of accepting a later screen reclassification", () => {
    expect(
      resolveLatchedAttachment(
        { mode: "bottom", surface: "dock" },
        { mode: "bottom", surface: "screen" },
      ),
    ).toEqual({ mode: "bottom", surface: "dock" });
  });

  it("treats a normal pet dragged deeper into the bottom reserve inside the Dock box as Dock", () => {
    const outsideDock = {
      x: 720,
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - normalSize.height / 2 + 8,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeAttachment(outsideDock, workAreaWithBottomDock, screenBounds, bottomDockBounds)).toEqual({
      mode: "bottom",
      surface: "dock",
    });
  });

  it("uses the Dock top when snapping a deeper bottom reserve state inside the Dock box", () => {
    const overDock = {
      x: 720,
      y: workAreaWithBottomDock.y + workAreaWithBottomDock.height - normalSize.height / 2 + 8,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeAttachment(overDock, workAreaWithBottomDock, screenBounds, bottomDockBounds)).toEqual({
      mode: "bottom",
      surface: "dock",
    });
    expect(
      computeAttachmentSnappedBounds(
        overDock,
        { mode: "bottom", surface: "dock" },
        workAreaWithBottomDock,
        screenBounds,
        bottomDockBounds,
      ),
    ).toEqual({
      x: centeredBottomX(overDock),
      y: bottomDockBounds.y - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("snaps a physical bottom screen edge when that edge is not occupied by the Dock", () => {
    const nearPhysicalBottom = {
      x: 320,
      y: screenBounds.y + screenBounds.height - normalSize.height - 8,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeAttachment(nearPhysicalBottom, workArea, screenBounds)).toEqual({
      mode: "bottom",
      surface: "screen",
    });
    expect(
      computeAttachmentSnappedBounds(
        nearPhysicalBottom,
        { mode: "bottom", surface: "screen" },
        workArea,
        screenBounds,
      ),
    ).toEqual({
      x: centeredBottomX(nearPhysicalBottom),
      y: screenBounds.y + screenBounds.height - BOTTOM_DOCK_SIZE.height,
      width: BOTTOM_DOCK_SIZE.width,
      height: BOTTOM_DOCK_SIZE.height,
    });
  });

  it("uses the work-area side edge when the Dock lives on a side", () => {
    const nearLeftDock = {
      x: workAreaWithLeftDock.x + 20,
      y: 220,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeMode(nearLeftDock, workAreaWithLeftDock)).toBe("left");
    expect(computeSnappedBounds(nearLeftDock, "left", workAreaWithLeftDock)).toEqual({
      x: workAreaWithLeftDock.x,
      y: 220,
      width: SIDE_PEEK_SIZE.width,
      height: SIDE_PEEK_SIZE.height,
    });
    expect(computeEdgeAttachment(nearLeftDock, workAreaWithLeftDock, screenBounds)).toEqual({
      mode: "left",
      surface: "dock",
    });
  });

  it("prioritizes a side Dock edge over the physical side screen edge behind it", () => {
    const insideLeftDockReserve = {
      x: screenBounds.x,
      y: 220,
      width: SIDE_PEEK_SIZE.width,
      height: SIDE_PEEK_SIZE.height,
    };
    expect(computeEdgeAttachment(insideLeftDockReserve, workAreaWithLeftDock, screenBounds)).toEqual({
      mode: "left",
      surface: "dock",
    });
    expect(
      computeAttachmentSnappedBounds(
        insideLeftDockReserve,
        { mode: "left", surface: "dock" },
        workAreaWithLeftDock,
        screenBounds,
      ),
    ).toEqual({
      x: workAreaWithLeftDock.x,
      y: 220,
      width: SIDE_PEEK_SIZE.width,
      height: SIDE_PEEK_SIZE.height,
    });
  });

  it("marks a physical screen edge separately from a Dock edge", () => {
    const nearPhysicalLeft = {
      x: workArea.x + 20,
      y: 220,
      width: normalSize.width,
      height: normalSize.height,
    };
    expect(computeEdgeAttachment(nearPhysicalLeft, workArea, screenBounds)).toEqual({
      mode: "left",
      surface: "screen",
    });
  });

  it("keeps a latched side peek until the user drags it back inside", () => {
    expect(
      computeEdgeMode(
        { x: 0, y: 200, width: peekSize.width, height: peekSize.height },
        workArea,
      ),
    ).toBe("left");
    expect(
      computeEdgeMode(
        { x: 25, y: 200, width: peekSize.width, height: peekSize.height },
        workArea,
      ),
    ).toBe("none");
  });

  it("restores to a fully visible normal window outside the side hot zone", () => {
    expect(
      computeSnappedBounds(
        { x: 220, y: 12, width: peekSize.width, height: peekSize.height },
        "none",
        workArea,
      ),
    ).toEqual({ x: 220, y: 25, width: normalSize.width, height: normalSize.height });
  });

  it("restores normal bounds before dragging out of a side peek", () => {
    expect(
      computeDetachedBounds(
        { x: 0, y: 220, width: SIDE_PEEK_SIZE.width, height: SIDE_PEEK_SIZE.height },
        { mode: "left", surface: "screen" },
        screenBounds,
      ),
    ).toEqual({ x: 0, y: 220, width: normalSize.width, height: normalSize.height });

    expect(
      computeDetachedBounds(
        { x: screenBounds.width - SIDE_PEEK_SIZE.width, y: 220, width: SIDE_PEEK_SIZE.width, height: SIDE_PEEK_SIZE.height },
        { mode: "right", surface: "screen" },
        screenBounds,
      ),
    ).toEqual({
      x: screenBounds.width - normalSize.width,
      y: 220,
      width: normalSize.width,
      height: normalSize.height,
    });
  });

  it("restores normal bounds before dragging out of a bottom rest", () => {
    expect(
      computeDetachedBounds(
        { x: 300, y: 804, width: BOTTOM_DOCK_SIZE.width, height: BOTTOM_DOCK_SIZE.height },
        { mode: "bottom", surface: "dock" },
        screenBounds,
      ),
    ).toEqual({
      x: 300,
      y: 748,
      width: normalSize.width,
      height: normalSize.height,
    });
  });
});
