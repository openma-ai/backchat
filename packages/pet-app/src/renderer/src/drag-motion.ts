import type { PetMotion } from "@open-managed-agents-desktop/pet-runtime";

const DRAG_MOTION_THRESHOLD = 4;

export function dragMotionForDelta(deltaX: number): PetMotion | null {
  if (deltaX > DRAG_MOTION_THRESHOLD) return "running-right";
  if (deltaX < -DRAG_MOTION_THRESHOLD) return "running-left";
  return null;
}
