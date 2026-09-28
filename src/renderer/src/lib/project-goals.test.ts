import { describe, expect, it } from "vitest";
import type { ProjectWorkView, ThreadGoal } from "@shared/project-work";
import { projectThreads, projectGoalPresentation, projectOutcomeLabel, projectCoordinatorTurns } from "./project-goals";
import { reduceTurn } from "./reduce-turn";

const goal = {
  id: "goal-1", scopeId: "p", workThreadId: "opaque-worker-thread",
  objective: "Ship a reviewed fix", status: "active", tokenBudget: 200000,
  tokensUsed: 12000, timeUsedSeconds: 30, revision: 1,
  createdAt: "2026-09-22T00:00:00Z", updatedAt: "2026-09-22T00:00:30Z",
} as ThreadGoal;

describe("project thread goals", () => {
  it("projects only coordinator turns with the original prompt and full agent activity", () => {
    const at = "2026-09-22T00:00:00Z";
    const event = (id: string, type: string, sessionId: string, turnId: string, data: unknown) => ({
      schema_version: "oma.event.v1", event_id: id, type, session_id: sessionId,
      turn_id: turnId, source: { kind: "harness" }, occurred_at: at, data,
    });
    const view = {
      project: { id: "p" },
      facts: {
        sessions: [
          { id: "coordinator-session", scopeId: "p", workThreadId: "p:coordinator", agentId: "coordinator" },
          { id: "worker-session", scopeId: "p", workThreadId: "p:worker", agentId: "worker" },
        ],
        turns: [
          { id: "coordinator-turn", sessionId: "coordinator-session", triggerEventId: "user-event", state: "completed", createdAt: at },
          { id: "worker-turn", sessionId: "worker-session", triggerEventId: "worker-event", state: "completed", createdAt: at },
        ],
        events: [
          { id: "user-event", payload: { text: "Ship the fix" } },
          { id: "worker-event", payload: { text: "Worker instruction" } },
        ],
        agentEvents: [
          event("start", "turn.started", "coordinator-session", "coordinator-turn", {}),
          event("tool-start", "tool.started", "coordinator-session", "coordinator-turn", { tool_call_id: "tool-1", title: "Read files" }),
          event("tool-done", "tool.completed", "coordinator-session", "coordinator-turn", { tool_call_id: "tool-1", title: "Read files" }),
          event("message", "agent.message", "coordinator-session", "coordinator-turn", { text: "Done", message_id: "message-1" }),
          event("done", "turn.completed", "coordinator-session", "coordinator-turn", {}),
          event("worker-message", "agent.message", "worker-session", "worker-turn", { text: "Private worker output" }),
        ],
      },
    } as unknown as ProjectWorkView;
    const turns = projectCoordinatorTurns(view);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ status: "complete", promptText: "Ship the fix", assistantText: "Done" });
    expect(reduceTurn(turns[0]!.events).tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Read files", status: "completed" }),
    ]));
    expect(JSON.stringify(turns)).not.toContain("Private worker output");
  });

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
