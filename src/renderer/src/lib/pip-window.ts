export const PIP_VIEWPORT_MARGIN = 16;
export const PIP_MIN_WIDTH = 320;
export const PIP_MIN_HEIGHT = 220;
export const PIP_DEFAULT_WIDTH = 480;
export const PIP_DEFAULT_HEIGHT = 360;

export type PipRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PipViewport = {
  width: number;
  height: number;
};

export type PipResizeEdge =
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function availableSize(viewportSize: number): number {
  return Math.max(0, viewportSize - PIP_VIEWPORT_MARGIN * 2);
}

export function constrainPipRect(rect: PipRect, viewport: PipViewport): PipRect {
  const availableWidth = availableSize(viewport.width);
  const availableHeight = availableSize(viewport.height);
  const width = clamp(rect.width, Math.min(PIP_MIN_WIDTH, availableWidth), availableWidth);
  const height = clamp(rect.height, Math.min(PIP_MIN_HEIGHT, availableHeight), availableHeight);
  return {
    x: clamp(rect.x, PIP_VIEWPORT_MARGIN, viewport.width - PIP_VIEWPORT_MARGIN - width),
    y: clamp(rect.y, PIP_VIEWPORT_MARGIN, viewport.height - PIP_VIEWPORT_MARGIN - height),
    width,
    height,
  };
}

export function createInitialPipRect(viewport: PipViewport): PipRect {
  const width = Math.min(PIP_DEFAULT_WIDTH, availableSize(viewport.width));
  const height = Math.min(PIP_DEFAULT_HEIGHT, availableSize(viewport.height));
  return constrainPipRect({
    x: viewport.width - PIP_VIEWPORT_MARGIN - width,
    y: viewport.height - PIP_VIEWPORT_MARGIN - height,
    width,
    height,
  }, viewport);
}

export function movePipRect(
  rect: PipRect,
  deltaX: number,
  deltaY: number,
  viewport: PipViewport,
): PipRect {
  return constrainPipRect({ ...rect, x: rect.x + deltaX, y: rect.y + deltaY }, viewport);
}

export function resizePipRect(
  rect: PipRect,
  edge: PipResizeEdge,
  deltaX: number,
  deltaY: number,
  viewport: PipViewport,
): PipRect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  const minimumWidth = Math.min(PIP_MIN_WIDTH, availableSize(viewport.width));
  const minimumHeight = Math.min(PIP_MIN_HEIGHT, availableSize(viewport.height));

  if (edge.includes("west")) {
    left = clamp(left + deltaX, PIP_VIEWPORT_MARGIN, right - minimumWidth);
  } else if (edge.includes("east")) {
    right = clamp(right + deltaX, left + minimumWidth, viewport.width - PIP_VIEWPORT_MARGIN);
  }
  if (edge.includes("north")) {
    top = clamp(top + deltaY, PIP_VIEWPORT_MARGIN, bottom - minimumHeight);
  } else if (edge.includes("south")) {
    bottom = clamp(bottom + deltaY, top + minimumHeight, viewport.height - PIP_VIEWPORT_MARGIN);
  }

  return constrainPipRect({ x: left, y: top, width: right - left, height: bottom - top }, viewport);
}
