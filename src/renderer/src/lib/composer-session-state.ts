import type { SessionGoal } from "./session-types";

/** How a session state is left again. Codex's two states cancel through
 * different transports — plan resets a config option, goal takes a control
 * prompt — so each presentation declares its own exit instead of the
 * composer hard-coding one per kind. */
export type ComposerSessionStateExit =
  | { kind: "setConfigOption"; configId: string; value: string | boolean }
  | { kind: "prompt"; text: string };

export interface ComposerSessionStatePresentation {
  id: string;
  kind: string;
  label: string;
  title?: string;
  icon: "goal" | "plan";
  exit?: ComposerSessionStateExit;
}

export interface ComposerSessionStateCandidate {
  priority: number;
  presentation?: ComposerSessionStatePresentation;
}

export function goalSessionStatePresentation(
  goal: SessionGoal | undefined,
  label: string,
): ComposerSessionStatePresentation | undefined {
  if (!goal) return undefined;
  return {
    id: `goal:${goal.objective}`,
    kind: "goal",
    label,
    title: goal.objective,
    icon: "goal",
    // Codex clears a goal through its own command, not a config option.
    exit: { kind: "prompt", text: "/goal clear" },
  };
}

export function selectComposerSessionStatePresentation(
  candidates: readonly ComposerSessionStateCandidate[],
): ComposerSessionStatePresentation | undefined {
  return [...candidates]
    .sort((left, right) => left.priority - right.priority)
    .find((candidate) => candidate.presentation)?.presentation;
}
