import type { ThreadGoal } from "@openmatter/project-host";
import type { ProjectWorkView } from "@shared/project-work";
import { projectResponseText } from "@shared/project-transcript";
import type { Turn as ChatTurn } from "./session-types";

type Session = ProjectWorkView["facts"]["sessions"][number];
type Turn = ProjectWorkView["facts"]["turns"][number];

export interface ProjectThread {
  workThreadId: string;
  role: "coordinator" | "worker";
  workerId?: string;
  runId?: string;
  session: Session;
  turns: Turn[];
  goal?: ThreadGoal;
}

/** Adapt durable project facts to the same TurnBlock used by ordinary chats. */
export function projectCoordinatorTurns(view: ProjectWorkView, runId?: string): ChatTurn[] {
  const sessions = new Set(
    view.facts.sessions
      .filter((session) => session.agentId === "coordinator" && session.scopeId === view.project.id)
      .filter((session) => !runId || association(view, session.workThreadId).runId === runId)
      .map((session) => session.id),
  );
  return view.facts.turns
    .filter((turn) => sessions.has(turn.sessionId))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((turn) => {
      const events = view.facts.agentEvents.filter((event) => event.turn_id === turn.id);
      const trigger = view.facts.events.find((event) => event.id === turn.triggerEventId);
      const prompt = (trigger?.payload as { text?: string } | undefined)?.text;
      const status = ({
        queued: "queued", running: "running", completed: "complete",
        failed: "error", cancelled: "cancelled",
      } as const)[turn.state];
      const failure = events.findLast((event) =>
        event.type === "turn.failed" || event.type === "session.error"
      );
      return {
        id: turn.id,
        sessionId: turn.sessionId,
        status,
        promptText: prompt ?? "",
        assistantText: projectResponseText(events),
        thoughtText: events.filter((event) => event.type === "agent.thinking")
          .map((event) => (event.data as { text?: string }).text ?? "").join(""),
        events: events.map((event) => ({
          payload: event,
          receivedAt: Date.parse(event.ingested_at ?? event.occurred_at),
        })),
        startedAt: Date.parse(turn.createdAt),
        ...(turn.completedAt ? { endedAt: Date.parse(turn.completedAt) } : {}),
        ...(turn.state === "failed" ? { errorMessage:
          (failure?.data as { error?: string } | undefined)?.error ?? "Turn failed.",
        } : {}),
      } satisfies ChatTurn;
    });
}

const association = (view: ProjectWorkView, workThreadId: string) => {
  const context = [...view.facts.contexts]
    .reverse()
    .find((item) => item.workThreadId === workThreadId);
  const value = context?.items.find(
    (item) => item.kind === "coordinator-association",
  )?.value as
    | { role?: "coordinator" | "worker"; workerId?: string; runId?: string }
    | undefined;
  return {
    role: value?.role ?? (workThreadId.endsWith(":coordinator") ? "coordinator" : "worker"),
    ...(value?.workerId ? { workerId: value.workerId } : {}),
    ...(value?.runId ? { runId: value.runId } : {}),
  };
};

/** Project one WorkThread, independent of replacement ACP sessions. */
export function projectThreads(view: ProjectWorkView, runId?: string): ProjectThread[] {
  const grouped = new Map<string, Session[]>();
  for (const session of view.facts.sessions) {
    if (session.scopeId !== view.project.id) continue;
    const current = grouped.get(session.workThreadId) ?? [];
    current.push(session);
    grouped.set(session.workThreadId, current);
  }
  const result: ProjectThread[] = [];
  for (const [workThreadId, sessions] of grouped) {
    const info = association(view, workThreadId);
    if (runId && info.runId !== runId) continue;
    const session = [...sessions].sort(
      (left, right) =>
        right.generation - left.generation ||
        right.lastUsedAt.localeCompare(left.lastUsedAt),
    )[0];
    if (!session) continue;
    const turns = view.facts.turns
      .filter((turn) => sessions.some((candidate) => candidate.id === turn.sessionId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const goal = view.facts.goals.find((candidate) => candidate.workThreadId === workThreadId);
    result.push({
      workThreadId,
      role: info.role,
      ...(info.workerId ? { workerId: info.workerId } : {}),
      ...(info.runId ? { runId: info.runId } : {}),
      session,
      turns,
      ...(goal ? { goal } : {}),
    });
  }
  return result;
}

const tokenLabel = (value: number) => {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
};

export function projectGoalPresentation(goal: ThreadGoal) {
  const tone = goal.status === "complete"
    ? "success"
    : goal.status === "blocked" || goal.status === "budget_limited" || goal.status === "usage_limited"
      ? "danger"
      : "neutral";
  return {
    title: goal.objective,
    status: goal.status,
    tone,
    elapsedSeconds: goal.timeUsedSeconds,
    elapsedSince: undefined,
    ...(goal.tokenBudget === undefined
      ? {}
      : { budgetLabel: `${tokenLabel(goal.tokensUsed)}/${tokenLabel(goal.tokenBudget)}` }),
    actions: {
      pause: goal.status === "active",
      resume: goal.status === "paused" || goal.status === "blocked" || goal.status === "usage_limited",
      dismiss: false,
    },
  } as const;
}

export function projectOutcomeLabel(status: ThreadGoal["status"]): string {
  return {
    active: "In progress",
    paused: "Paused",
    blocked: "Blocked",
    usage_limited: "Limit reached",
    budget_limited: "Budget reached",
    complete: "Complete",
  }[status];
}
