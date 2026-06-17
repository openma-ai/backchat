import type { PetMotion } from "@open-managed-agents-desktop/pet-runtime";
import type { PetMood, PetViewState } from "./pet-controller";

export type AtlasRowState =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export type PlaybackIntensity = "quiet" | "normal" | "attention";

export type AtlasPlayback = {
  rowState: AtlasRowState;
  row: number;
  frames: number;
  durationMs: number;
  intensity: PlaybackIntensity;
};

export function presentationForState(state: PetViewState, dragMotion: PetMotion | null = null): AtlasPlayback {
  const motion = dragMotion ?? state.motion;
  const rowState = atlasRowForMotion(motion);
  const row = atlasMetadata(rowState);
  return {
    ...row,
    rowState,
    durationMs: durationFor(rowState, intensityForState(state)),
    intensity: intensityForState(state),
  };
}

export function atlasRowForMotion(motion: PetMotion): AtlasRowState {
  switch (motion) {
    case "running-right":
      return "running-right";
    case "running-left":
      return "running-left";
    case "waving":
    case "speak":
    case "nudge":
      return "waving";
    case "jumping":
    case "wake":
    case "celebrate":
      return "jumping";
    case "failed":
    case "warn":
      return "failed";
    case "waiting":
    case "ask":
    case "wait":
    case "handoff":
      return "waiting";
    case "running":
    case "think":
    case "tool-edit":
    case "tool-run":
    case "tool-other":
      return "running";
    case "review":
    case "tool-read":
    case "tool-search":
    case "tool-fetch":
      return "review";
    default:
      return "idle";
  }
}

export function intensityForState(state: Pick<PetViewState, "motion" | "mood" | "priority">): PlaybackIntensity {
  if (state.priority === "urgent" || state.priority === "high" || isAttentionMood(state.mood)) {
    return "attention";
  }
  if (state.motion === "idle" || state.priority === "low") return "quiet";
  return "normal";
}

export function isWorkMotion(motion: PetMotion): boolean {
  return (
    motion === "think" ||
    motion === "tool-read" ||
    motion === "tool-edit" ||
    motion === "tool-run" ||
    motion === "tool-search" ||
    motion === "tool-fetch" ||
    motion === "tool-other"
  );
}

export function runningFallbackAfterTransient(
  current: PetViewState,
  lastWorkState: PetViewState | null,
  now = Date.now(),
): PetViewState | null {
  if (current.motion !== "waving" || !lastWorkState || !isWorkMotion(lastWorkState.motion)) return null;
  return {
    ...lastWorkState,
    motion: "running",
    mood: "focused",
    intensity: "medium",
    priority: "normal",
    proactive: false,
    updatedAt: now,
  };
}

function isAttentionMood(mood: PetMood): boolean {
  return mood === "asking" || mood === "worried" || mood === "proud";
}

function atlasMetadata(rowState: AtlasRowState): Pick<AtlasPlayback, "row" | "frames"> {
  switch (rowState) {
    case "running-right":
      return { row: 1, frames: 8 };
    case "running-left":
      return { row: 2, frames: 8 };
    case "waving":
      return { row: 3, frames: 4 };
    case "jumping":
      return { row: 4, frames: 5 };
    case "failed":
      return { row: 5, frames: 8 };
    case "waiting":
      return { row: 6, frames: 6 };
    case "running":
      return { row: 7, frames: 6 };
    case "review":
      return { row: 8, frames: 6 };
    default:
      return { row: 0, frames: 6 };
  }
}

function durationFor(rowState: AtlasRowState, intensity: PlaybackIntensity): number {
  if (intensity === "quiet") {
    if (rowState === "idle") return 1600;
    return 1100;
  }
  switch (rowState) {
    case "running-right":
    case "running-left":
      return 800;
    case "waving":
      return 760;
    case "jumping":
      return 620;
    case "failed":
      return 920;
    case "waiting":
      return 980;
    case "running":
      return 820;
    case "review":
      return 900;
    default:
      return 1300;
  }
}
