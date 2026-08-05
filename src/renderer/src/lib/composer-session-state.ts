import type { SessionGoal } from "./session-types";

export interface ComposerSessionStatePresentation {
  id: string;
  kind: string;
  label: string;
  title?: string;
  icon: "goal" | "plan";
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
  };
}

export function selectComposerSessionStatePresentation(
  candidates: readonly ComposerSessionStateCandidate[],
): ComposerSessionStatePresentation | undefined {
  return [...candidates]
    .sort((left, right) => left.priority - right.priority)
    .find((candidate) => candidate.presentation)?.presentation;
}
