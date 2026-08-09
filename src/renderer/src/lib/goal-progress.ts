import { formatTokenBudget } from "./elapsed-clock";
import type { ComposerProgressPresentation } from "./composer-progress";
import type { SessionGoal } from "./session-types";

export interface GoalProgressLabels {
  active: string;
  paused: string;
  stalled: string;
  complete: string;
  blocked: string;
  fallback: string;
}

/** Statuses that can be picked back up. `stalled` is one the adapter reports
 *  for a goal nothing is advancing; the reference client offers resume for it,
 *  and leaving it out here left the row with no way forward. */
const RESUMABLE = new Set(["paused", "stalled"]);

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
          : status === "stalled"
            ? labels.stalled
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
    // Only what the agent reported. Computing the wall clock here froze it: the
    // row treats a reported value as authoritative, so a one-off Date.now()
    // became a number that never moved. The start time is passed instead and
    // the row derives from it every tick.
    elapsedSeconds: goal.timeUsedSeconds,
    // The agent budgets a goal in tokens and reports both numbers. Showing
    // neither made a goal near its limit look like one with no limit at all.
    ...(formatTokenBudget(goal.tokensUsed, goal.tokenBudget)
      ? { budgetLabel: formatTokenBudget(goal.tokensUsed, goal.tokenBudget)! }
      : {}),
    ...(goal.createdAt ? { elapsedSince: goal.createdAt } : {}),
    items: [],
    actions: {
      edit: true,
      pause: status === "active" || status === "in_progress",
      resume: RESUMABLE.has(status),
      dismiss: true,
    },
  };
}
