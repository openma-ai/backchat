import type { SessionGoal } from "./session-types";

/** How a session state is left again. Codex's two states cancel through
 * different transports — plan resets a config option, goal calls the extension
 * method its own snapshot advertises — so each presentation declares its own
 * exit instead of the composer hard-coding one per kind. */
export type ComposerSessionStateExit =
  | { kind: "setConfigOption"; configId: string; value: string | boolean }
  | {
    kind: "extensionMethod";
    method: string;
    params?: Record<string, unknown>;
    /** Transport to use when the runtime has no extension channel. */
    fallback?: { kind: "prompt"; text: string };
  }
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

/** Prompt form of clearing a goal. Codex parses it server-side, so it works
 * everywhere, but it spends a turn — only used when no control method was
 * advertised or the runtime has no extension channel. */
export const GOAL_CLEAR_PROMPT = "/goal clear";

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
    // A goal is cleared through the extension method the snapshot named. Sending
    // "/goal clear" as a prompt also works but spends a whole turn on it, and
    // the method name differs between adapter builds — so follow what this
    // agent advertised and fall back to the prompt only when it advertised
    // nothing.
    exit: goal.controlMethod
      ? {
        kind: "extensionMethod",
        method: goal.controlMethod,
        params: { action: "clear" },
        fallback: { kind: "prompt", text: GOAL_CLEAR_PROMPT },
      }
      : { kind: "prompt", text: GOAL_CLEAR_PROMPT },
  };
}

export function selectComposerSessionStatePresentation(
  candidates: readonly ComposerSessionStateCandidate[],
): ComposerSessionStatePresentation | undefined {
  return [...candidates]
    .sort((left, right) => left.priority - right.priority)
    .find((candidate) => candidate.presentation)?.presentation;
}
