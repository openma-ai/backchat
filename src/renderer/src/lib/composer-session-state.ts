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

/** Session-state commands the composer may arm into the shared Goal/Plan slot.
 * A chip is a state, not a token: showing `/goal` leaks the wire form the
 * composer prefixes for the user, and it would read differently from the chip
 * that replaces it once the goal exists. Commands that merely take an argument
 * (`/login`, `/model`) stay in the prompt. Adding another state is a data
 * change. */
const ARMED_COMMAND_STATE_LABELS: Record<string, "goal"> = { goal: "goal" };

export function armedCommandSessionStatePresentation(
  command: { name: string; description?: string; input?: { hint?: string } | null },
  labels: { goal: string },
): ComposerSessionStatePresentation | undefined {
  const stateLabel = ARMED_COMMAND_STATE_LABELS[command.name];
  if (!stateLabel) return undefined;
  return {
    id: `armed:${command.name}`,
    kind: "armed_command",
    label: labels[stateLabel],
    title: command.input?.hint?.trim() || command.description,
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

/** Whether a sent-but-unconfirmed command should still hold its chip.
 *
 * Clearing the armed chip at submit time left the composer stateless for a
 * beat: the real state chip only appears once the agent publishes its snapshot,
 * a round trip later. So the armed chip stays until something replaces it —
 * either the state it was entering, or a turn that came and went without one,
 * which means the agent rejected it and there is no state to show. */
export function armedCommandStillPending(state: {
  sent: boolean;
  observedRun: boolean;
  stateActive: boolean;
  running: boolean;
}): boolean {
  if (state.stateActive) return false;
  if (!state.sent) return true;
  return !(state.observedRun && !state.running);
}
