import type { PetAction, PetSignal } from "@open-managed-agents-desktop/pet-runtime";

export type PetHarnessEvent = {
  harness: string;
  event: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  agentId?: string;
  label?: string;
  payload?: unknown;
};

export interface PetHarnessAdapter {
  id: string;
  canHandle(event: PetHarnessEvent): boolean;
  normalize(event: PetHarnessEvent): PetSignal[];
  navigationUrlForAction(action: PetAction): string | undefined;
}

export interface PetHarnessRegistry {
  normalize(event: PetHarnessEvent): PetSignal[];
  navigationUrlForAction(action: PetAction): string | undefined;
}

const codexEventMap: Record<string, string> = {
  "thread.started": "session.started",
  "task.started": "session.started",
  "task.completed": "session.completed",
  "message.completed": "session.completed",
  "turn.completed": "session.completed",
  "task.failed": "session.failed",
  "error": "session.failed",
  "approval.requested": "permission.requested",
  "permission.requested": "permission.requested",
  "review.started": "review.started",
  "waiting": "handoff.waiting",
  "input.required": "handoff.waiting",
  "tool.read": "tool.read",
  "tool.edit": "tool.edit",
  "tool.run": "tool.run",
  "tool.search": "tool.search",
  "tool.fetch": "tool.fetch",
};

const backchatEventMap: Record<string, string> = {
  "session.started": "session.started",
  "session.completed": "session.completed",
  "session.failed": "session.failed",
  "permission.requested": "permission.requested",
  "review.started": "review.started",
  "handoff.waiting": "handoff.waiting",
  "tool.read": "tool.read",
  "tool.edit": "tool.edit",
  "tool.run": "tool.run",
  "tool.search": "tool.search",
  "tool.fetch": "tool.fetch",
};

export function createPetHarnessRegistry(
  adapters: PetHarnessAdapter[] = [codexHarnessAdapter(), backchatHarnessAdapter()],
): PetHarnessRegistry {
  return {
    normalize(event) {
      return adapters.find((adapter) => adapter.canHandle(event))?.normalize(event) ?? [];
    },
    navigationUrlForAction(action) {
      for (const adapter of adapters) {
        const url = adapter.navigationUrlForAction(action);
        if (url) return url;
      }
      return undefined;
    },
  };
}

function codexHarnessAdapter(): PetHarnessAdapter {
  return {
    id: "codex",
    canHandle: (event) => event.harness === "codex",
    normalize: (event) => genericNormalize(event, "codex", codexEventMap, codexThreadIdFromEvent(event)),
    navigationUrlForAction(action) {
      if (!hasSessionTarget(action)) return undefined;
      if (action.source !== "codex" || !action.sessionId) return undefined;
      const threadId = normalizeCodexThreadId(action.sessionId);
      if (!threadId) return undefined;
      return `codex://threads/${encodeURIComponent(threadId)}`;
    },
  };
}

function backchatHarnessAdapter(): PetHarnessAdapter {
  return {
    id: "backchat",
    canHandle: (event) => event.harness === "backchat",
    normalize: (event) => genericNormalize(event, "backchat.sidecar", backchatEventMap, event.sessionId),
    navigationUrlForAction(action) {
      if (!hasSessionTarget(action)) return undefined;
      if (!action.sessionId) return undefined;
      if (
        action.source &&
        action.source !== "pet-app" &&
        !action.source.startsWith("sidecar.") &&
        !action.source.startsWith("backchat")
      ) {
        return undefined;
      }
      return `backchat://sessions/${encodeURIComponent(action.sessionId)}`;
    },
  };
}

function hasSessionTarget(
  action: PetAction,
): action is Extract<PetAction, { type: "motion" | "speech" }> {
  return action.type === "motion" || action.type === "speech";
}

function codexThreadIdFromEvent(event: PetHarnessEvent): string | undefined {
  return normalizeCodexThreadId(event.threadId) ?? normalizeCodexThreadId(event.sessionId);
}

function normalizeCodexThreadId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const bare = trimmed.startsWith("codex:") ? trimmed.slice("codex:".length) : trimmed;
  return isUuid(bare) ? bare : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function genericNormalize(
  event: PetHarnessEvent,
  source: string,
  eventMap: Record<string, string>,
  sessionId: string | undefined,
): PetSignal[] {
  const name = eventMap[event.event];
  if (!name || !sessionId) return [];
  const labels: Record<string, string> = { harness: event.harness };
  if (event.label) labels["title"] = event.label;
  if (event.threadId) labels["threadId"] = event.threadId;

  return [
    {
      id: `${event.harness}:${sessionId}:${event.turnId ? `${event.turnId}:` : ""}${event.event}`,
      source,
      name,
      sessionId,
      turnId: event.turnId,
      agentId: event.agentId,
      labels,
      payload: event,
    },
  ];
}
