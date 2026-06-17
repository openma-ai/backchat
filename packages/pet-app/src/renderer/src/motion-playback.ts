import type { PetMotion } from "@open-managed-agents-desktop/pet-runtime";

const durableMotions = new Set<PetMotion>([
  "idle",
  "sleep",
  "ask",
  "wait",
  "handoff",
  "tool-read",
  "tool-edit",
  "tool-run",
  "tool-search",
  "tool-fetch",
]);

export function shouldAnimateSprite(motion: PetMotion): boolean {
  return motion !== "sleep";
}

export function shouldAutoSettleMotion(motion: PetMotion): boolean {
  return !durableMotions.has(motion);
}
