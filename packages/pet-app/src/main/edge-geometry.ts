export type EdgeMode = "none" | "left" | "right" | "top" | "bottom";
export type EdgeSurface = "screen" | "dock";

export type EdgeAttachment = {
  mode: EdgeMode;
  surface: EdgeSurface;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

import {
  BOTTOM_SCREEN_WINDOW_SIZE,
  BOTTOM_REST_SIZE,
  NORMAL_WINDOW_SIZE,
  SIDE_PEEK_SIZE,
  TOP_PEEK_SIZE,
} from "../shared/pet-size-model";

export const NORMAL_SIZE = NORMAL_WINDOW_SIZE;
export { BOTTOM_REST_SIZE, BOTTOM_SCREEN_WINDOW_SIZE, SIDE_PEEK_SIZE, TOP_PEEK_SIZE };
export const BOTTOM_DOCK_SIZE = BOTTOM_REST_SIZE;
export const TOP_TRIGGER_DISTANCE = 24;
export const BOTTOM_TRIGGER_DISTANCE = 18;
export const SIDE_HIDDEN_DEPTH = 0;
export const SIDE_TRIGGER_VISIBLE_WIDTH = 24;

export function computeEdgeMode(bounds: Rect, workArea: Rect): EdgeMode {
  if (isLatchedLeftPeek(bounds, workArea)) return "left";
  if (isLatchedRightPeek(bounds, workArea)) return "right";
  const distanceToLeft = bounds.x - workArea.x;
  const distanceToRight = workArea.x + workArea.width - (bounds.x + bounds.width);
  if (distanceToLeft <= SIDE_TRIGGER_VISIBLE_WIDTH) return "left";
  if (distanceToRight <= SIDE_TRIGGER_VISIBLE_WIDTH) return "right";
  if (bounds.y - workArea.y <= TOP_TRIGGER_DISTANCE) return "top";
  if (bounds.y + bounds.height >= workArea.y + workArea.height - BOTTOM_TRIGGER_DISTANCE) return "bottom";
  return "none";
}

export function computeEdgeAttachment(bounds: Rect, workArea: Rect, screenBounds: Rect): EdgeAttachment;
export function computeEdgeAttachment(
  bounds: Rect,
  workArea: Rect,
  screenBounds: Rect,
  dockBounds: Rect | undefined,
): EdgeAttachment;
export function computeEdgeAttachment(
  bounds: Rect,
  workArea: Rect,
  screenBounds: Rect,
  dockBounds?: Rect,
): EdgeAttachment {
  const bottomAttachment = computeBottomAttachment(bounds, workArea, screenBounds, dockBounds);
  if (bottomAttachment.mode !== "none") return bottomAttachment;

  const dockMode = computeEdgeMode(bounds, workArea);
  if (dockMode !== "none" && dockMode !== "bottom") {
    return { mode: dockMode, surface: surfaceForAttachment(bounds, dockMode, workArea, screenBounds) };
  }
  const screenMode = computeEdgeMode(bounds, screenBounds);
  if (screenMode !== "none") return { mode: screenMode, surface: "screen" };
  return { mode: "none", surface: "screen" };
}

export function resolveLatchedAttachment(
  latchedAttachment: EdgeAttachment | null,
  computedAttachment: EdgeAttachment,
): EdgeAttachment {
  return latchedAttachment ?? computedAttachment;
}

export function computeSnappedBounds(bounds: Rect, mode: EdgeMode, workArea: Rect): Rect {
  return computeSnappedBoundsInArea(bounds, mode, workArea);
}

export function computeAttachmentSnappedBounds(
  bounds: Rect,
  attachment: EdgeAttachment,
  workArea: Rect,
  screenBounds: Rect,
  dockBounds?: Rect,
): Rect {
  if (attachment.surface === "dock" && dockBounds) {
    return computeDockSnappedBounds(bounds, attachment.mode, dockBounds, screenBounds);
  }
  if (attachment.mode === "bottom" && attachment.surface === "screen") {
    return computeScreenBottomWindowBounds(bounds, screenBounds);
  }
  const area =
    attachment.surface === "dock"
      ? workArea
      : screenBounds;
  return computeSnappedBoundsInArea(bounds, attachment.mode, area);
}

export function computeDetachedBounds(bounds: Rect, attachment: EdgeAttachment, screenBounds: Rect): Rect {
  if (attachment.mode === "none" && bounds.width === NORMAL_SIZE.width && bounds.height === NORMAL_SIZE.height) {
    return bounds;
  }

  const next: Rect = {
    x: bounds.x,
    y: bounds.y,
    width: NORMAL_SIZE.width,
    height: NORMAL_SIZE.height,
  };

  if (attachment.mode === "right") {
    next.x = bounds.x + bounds.width - NORMAL_SIZE.width;
  }
  if (attachment.mode === "bottom") {
    next.x = bounds.x + bounds.width / 2 - NORMAL_SIZE.width / 2;
    next.y = bounds.y + bounds.height - NORMAL_SIZE.height;
  }
  if (attachment.mode === "top") {
    next.x = bounds.x + bounds.width / 2 - NORMAL_SIZE.width / 2;
  }

  next.x = clamp(next.x, screenBounds.x, screenBounds.x + screenBounds.width - NORMAL_SIZE.width);
  next.y = clamp(next.y, screenBounds.y, screenBounds.y + screenBounds.height - NORMAL_SIZE.height);
  return next;
}

function computeSnappedBoundsInArea(bounds: Rect, mode: EdgeMode, area: Rect): Rect {
  const isSidePeek = mode === "left" || mode === "right";
  const target = isSidePeek
    ? SIDE_PEEK_SIZE
    : mode === "top"
      ? TOP_PEEK_SIZE
      : mode === "bottom"
        ? BOTTOM_DOCK_SIZE
        : NORMAL_SIZE;
  const visibleWidth = SIDE_PEEK_SIZE.width - SIDE_HIDDEN_DEPTH;
  const next: Rect = {
    x: bounds.x,
    y: clamp(bounds.y, area.y, area.y + area.height - target.height),
    width: target.width,
    height: target.height,
  };

  if (mode === "left") next.x = area.x - SIDE_HIDDEN_DEPTH;
  if (mode === "right") next.x = area.x + area.width - visibleWidth;
  if (mode === "top") {
    next.x = clamp(bounds.x, area.x, area.x + area.width - target.width);
    next.y = area.y;
  }
  if (mode === "bottom") {
    next.x = clamp(bounds.x + bounds.width / 2 - target.width / 2, area.x, area.x + area.width - target.width);
    next.y = area.y + area.height - target.height;
  }
  if (mode === "none") {
    next.x = clamp(bounds.x, area.x, area.x + area.width - target.width);
  }

  return next;
}

function computeDockSnappedBounds(bounds: Rect, mode: EdgeMode, dockBounds: Rect, screenBounds: Rect): Rect {
  const isSidePeek = mode === "left" || mode === "right";
  const target = isSidePeek
    ? SIDE_PEEK_SIZE
    : mode === "top"
      ? TOP_PEEK_SIZE
      : mode === "bottom"
        ? BOTTOM_DOCK_SIZE
        : NORMAL_SIZE;
  const next: Rect = {
    x: bounds.x,
    y: bounds.y,
    width: target.width,
    height: target.height,
  };

  if (mode === "bottom") {
    next.x = clamp(
      bounds.x + bounds.width / 2 - target.width / 2,
      dockBounds.x,
      dockBounds.x + dockBounds.width - target.width,
    );
    next.y = dockBounds.y - target.height;
    return next;
  }

  if (mode === "top") {
    next.x = clamp(
      bounds.x + bounds.width / 2 - target.width / 2,
      dockBounds.x,
      dockBounds.x + dockBounds.width - target.width,
    );
    next.y = dockBounds.y + dockBounds.height;
    return next;
  }

  if (mode === "left") {
    next.x = dockBounds.x + dockBounds.width;
    next.y = clamp(bounds.y, screenBounds.y, screenBounds.y + screenBounds.height - target.height);
    return next;
  }

  if (mode === "right") {
    next.x = dockBounds.x - target.width;
    next.y = clamp(bounds.y, screenBounds.y, screenBounds.y + screenBounds.height - target.height);
    return next;
  }

  next.x = clamp(bounds.x, screenBounds.x, screenBounds.x + screenBounds.width - target.width);
  next.y = clamp(bounds.y, screenBounds.y, screenBounds.y + screenBounds.height - target.height);
  return next;
}

function computeScreenBottomWindowBounds(bounds: Rect, screenBounds: Rect): Rect {
  const screenBottom = screenBounds.y + screenBounds.height;
  return {
    x: clamp(
      bounds.x + bounds.width / 2 - BOTTOM_SCREEN_WINDOW_SIZE.width / 2,
      screenBounds.x,
      screenBounds.x + screenBounds.width - BOTTOM_SCREEN_WINDOW_SIZE.width,
    ),
    y: screenBottom - BOTTOM_SCREEN_WINDOW_SIZE.height,
    width: BOTTOM_SCREEN_WINDOW_SIZE.width,
    height: BOTTOM_SCREEN_WINDOW_SIZE.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isLatchedLeftPeek(bounds: Rect, workArea: Rect): boolean {
  return bounds.width === SIDE_PEEK_SIZE.width && bounds.x <= workArea.x;
}

function isLatchedRightPeek(bounds: Rect, workArea: Rect): boolean {
  return bounds.width === SIDE_PEEK_SIZE.width && bounds.x + bounds.width >= workArea.x + workArea.width;
}

function edgeSurfaceForMode(mode: EdgeMode, workArea: Rect, screenBounds: Rect): EdgeSurface {
  if (mode === "left" && workArea.x > screenBounds.x) return "dock";
  if (mode === "right" && workArea.x + workArea.width < screenBounds.x + screenBounds.width) return "dock";
  if (mode === "top" && workArea.y > screenBounds.y) return "dock";
  return "screen";
}

function surfaceForAttachment(bounds: Rect, mode: EdgeMode, workArea: Rect, screenBounds: Rect): EdgeSurface {
  if (mode === "bottom" && hasBottomDockReserve(workArea, screenBounds)) return "dock";
  return edgeSurfaceForMode(mode, workArea, screenBounds);
}

function computeBottomAttachment(
  bounds: Rect,
  workArea: Rect,
  screenBounds: Rect,
  dockBounds?: Rect,
): EdgeAttachment {
  const workBottom = workArea.y + workArea.height;
  const screenBottom = screenBounds.y + screenBounds.height;
  const boundsBottom = bounds.y + bounds.height;
  const boundsCenterX = bounds.x + bounds.width / 2;
  if (!hasBottomDockReserve(workArea, screenBounds)) {
    return boundsBottom >= screenBottom - BOTTOM_TRIGGER_DISTANCE
      ? { mode: "bottom", surface: "screen" }
      : { mode: "none", surface: "screen" };
  }

  if (dockBounds) {
    if (isWithinDockHorizontalProjection(boundsCenterX, dockBounds)) {
      return boundsBottom >= dockBounds.y - BOTTOM_TRIGGER_DISTANCE
        ? { mode: "bottom", surface: "dock" }
        : { mode: "none", surface: "screen" };
    }
    return boundsBottom >= screenBottom - BOTTOM_TRIGGER_DISTANCE
      ? { mode: "bottom", surface: "screen" }
      : { mode: "none", surface: "screen" };
  }

  const boundsCenterY = bounds.y + bounds.height / 2;
  if (boundsCenterY >= workBottom) {
    return { mode: "bottom", surface: "screen" };
  }
  if (boundsBottom >= workBottom - BOTTOM_TRIGGER_DISTANCE) {
    return { mode: "bottom", surface: "dock" };
  }
  return { mode: "none", surface: "screen" };
}

function isWithinDockHorizontalProjection(centerX: number, dockBounds: Rect): boolean {
  return centerX >= dockBounds.x && centerX <= dockBounds.x + dockBounds.width;
}

function hasBottomDockReserve(workArea: Rect, screenBounds: Rect): boolean {
  const workAreaBottom = workArea.y + workArea.height;
  const screenBottom = screenBounds.y + screenBounds.height;
  return workAreaBottom < screenBottom;
}
