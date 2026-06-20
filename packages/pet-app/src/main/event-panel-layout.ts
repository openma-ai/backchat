import type { Rectangle } from "electron";

export type EventPanelLayout = {
  bounds: Rectangle;
  pet: { left: number; top: number; width: number; height: number };
  panel: { left: number; top: number; width: number; height: number };
  side: "left" | "right";
};

const PANEL = { width: 300, height: 174 };
const GAP = 16;
const MARGIN = 20;
const CLOSE_CONTROL_ROOM = 44;

export function computeEventPanelLayout(petBounds: Rectangle, displayBounds: Rectangle): EventPanelLayout {
  const width = Math.min(displayBounds.width, petBounds.width + PANEL.width + GAP + MARGIN * 2);
  const height = Math.min(displayBounds.height, Math.max(petBounds.height, PANEL.height + CLOSE_CONTROL_ROOM) + MARGIN * 2);
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  const petRight = petBounds.x + petBounds.width;
  const spaceRight = displayRight - petRight;
  const spaceLeft = petBounds.x - displayBounds.x;
  const side: "left" | "right" = spaceRight >= PANEL.width + GAP || spaceRight >= spaceLeft ? "right" : "left";

  const desiredX = side === "right"
    ? petBounds.x - MARGIN
    : petRight - width + MARGIN;
  const desiredY = petBounds.y + petBounds.height / 2 - height / 2;
  const x = clamp(Math.round(desiredX), displayBounds.x, displayRight - width);
  const y = clamp(Math.round(desiredY), displayBounds.y, displayBottom - height);
  const petLeft = Math.round(petBounds.x - x);
  const petTop = Math.round(petBounds.y - y);
  const panelTop = clamp(
    Math.round(petTop + petBounds.height / 2 - PANEL.height / 2),
    MARGIN,
    height - PANEL.height - CLOSE_CONTROL_ROOM,
  );
  const idealPanelLeft = side === "right"
    ? petLeft + petBounds.width + GAP
    : petLeft - GAP - PANEL.width;
  const panelLeft = clamp(Math.round(idealPanelLeft), MARGIN, width - PANEL.width - MARGIN);

  return {
    bounds: { x, y, width, height },
    pet: { left: petLeft, top: petTop, width: petBounds.width, height: petBounds.height },
    panel: { left: panelLeft, top: panelTop, ...PANEL },
    side,
  };
}

export function computeClosedPetBounds(layout: EventPanelLayout): Rectangle {
  return {
    x: layout.bounds.x + layout.pet.left,
    y: layout.bounds.y + layout.pet.top,
    width: layout.pet.width,
    height: layout.pet.height,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
