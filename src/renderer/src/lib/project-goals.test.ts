import { describe, expect, it } from "vitest";
import type { ProjectWorkView, ThreadGoal } from "@shared/project-work";
import { projectThreads, projectGoalPresentation, projectOutcomeLabel } from "./project-goals";

const goal = {
  id: "goal-1", scopeId: "p", workThreadId: "opaque-worker-thread",
  objective: "Ship a reviewed fix", status: "active", tokenBudget: 200000,
  tokensUsed: 12000, timeUsedSeconds: 30, revision: 1,
  createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:30Z",
} as ThreadGoal;

describe("project thread goals", () => {
  it("keeps one worker and its active goal across replacement sessions and completed turns", () => {
    const view = {
      project: { id: "p" },
      facts: {
        sessions: [
          { id: "new", scopeId: "p", workThreadId: "opaque-worker-thread", agentId: "worker", generation: 2, lastUsedAt: "2026-09-22T00:01:00Z" },
          { id: "old", scopeId: "p", workThreadId: "opaque-worker-thread", agentId: "worker", generation: 1, lastUsedAt: "2026-09-22T00:02:00Z" },
        ],
        contexts: [{ scopeId: "p", workThreadId: "opaque-worker-thread", createdAt: "2026-09-22T00:00:00Z", items: [{ kind: "coordinator-association", value: { scopeId: "p", role: "worker", workerId: "fix/api", runId: "run-a" } }] }],
        turns: [{ id: "old-turn", sessionId: "old", state: "completed", createdAt: "2026-09-22T00:00:00Z" }, { id: "new-turn", sessionId: "new", state: "completed", createdAt: "2026-09-22T00:01:00Z" }],
        goals: [goal],
      },
    } as unknown as ProjectWorkView;
    const threads = projectThreads(view, "run-a");
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ workThreadId: "opaque-worker-thread", workerId: "fix/api", session: { id: "new" }, goal: { status: "active" } });
    expect(threads[0]!.turns.map(turn => turn.id)).toEqual(["old-turn", "new-turn"]);
    expect(projectThreads(view, "run-b")).toEqual([]);
  });

  it.each([
    ["active", true, false, "neutral"],
    ["paused", false, true, "neutral"],
    ["blocked", false, true, "danger"],
    ["usage_limited", false, true, "danger"],
    ["budget_limited", false, false, "danger"],
    ["complete", false, false, "success"],
  ] as const)("keeps %s goal controls independent from native harness capabilities", (status, pause, resume, tone) => {
    const presentation = projectGoalPresentation({ ...goal, status });
    expect(presentation).toMatchObject({ title: "Ship a reviewed fix", status, tone, elapsedSeconds: 30, budgetLabel: "12k/200k", actions: { pause, resume, dismiss: false } });
    expect(presentation.elapsedSince).toBeUndefined();
  });

  it("uses project outcome language for the Claude Projects surface", () => {
    expect(projectOutcomeLabel("active")).toBe("In progress");
    expect(projectOutcomeLabel("blocked")).toBe("Blocked");
    expect(projectOutcomeLabel("complete")).toBe("Complete");
  });
});
