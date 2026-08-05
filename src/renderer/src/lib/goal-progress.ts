import type { ComposerProgressPresentation } from "./composer-progress";
import type { SessionGoal } from "./session-types";

export interface GoalProgressLabels {
  active: string;
  paused: string;
  complete: string;
  blocked: string;
  fallback: string;
}

/** Adapt the session Goal domain into the reusable composer progress model.
 * Goal-specific status language and actions stop at this boundary. */
export function goalProgressPresentation(
  goal: SessionGoal,
  labels: GoalProgressLabels,
): ComposerProgressPresentation {
  const status = goal.status.trim().toLowerCase();
  return {
    id: ["goal", goal.objective, goal.tokenBudget ?? ""].join("\u001f"),
    kind: "goal",
    label:
      status === "active" || status === "in_progress"
        ? labels.active
        : status === "paused"
          ? labels.paused
          : status === "complete" || status === "completed"
            ? labels.complete
            : status === "blocked"
              ? labels.blocked
              : labels.fallback,
    title: goal.objective,
    status,
    icon: "target",
    tone:
      status === "complete" || status === "completed"
        ? "success"
        : status === "blocked"
          ? "danger"
          : "neutral",
    elapsedSeconds: goal.timeUsedSeconds,
    items: [],
    actions: {
      edit: true,
      pause: status === "active" || status === "in_progress",
      resume: status === "paused",
      dismiss: true,
    },
  };
}
