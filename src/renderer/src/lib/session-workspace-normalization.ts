import type {
  SessionRow,
  SideTab,
  SideTabType,
  SubagentActivity,
  Turn,
  WorkspaceArtifacts,
} from "./session-types";

export function defaultSideTabLabel(type: SideTabType, payload: string): string {
  switch (type) {
    case "chat":
      return "Side chat";
    case "subagent":
      return "子任务";
    case "file": {
      const trimmed = payload.replace(/\/+$/, "");
      const last = trimmed.split("/").pop();
      return last || "Files";
    }
    case "browser":
      try {
        const url = new URL(payload);
        return url.hostname || "Browser";
      } catch {
        return "Browser";
      }
    case "terminal": {
      const trimmed = payload.replace(/\/+$/, "");
      const last = trimmed.split("/").pop();
      return last || "Terminal";
    }
    case "interactive":
      return "Interactive";
  }
}
export function isSideSessionTab(type: SideTabType): boolean {
  return type === "chat" || type === "subagent";
}

const SIDE_TAB_TYPES = new Set<SideTabType>([
  "chat",
  "subagent",
  "file",
  "browser",
  "terminal",
  "interactive",
]);

export function isPersistedSideTab(value: unknown): value is SideTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<SideTab>;
  return (
    typeof tab.id === "string" &&
    typeof tab.type === "string" &&
    SIDE_TAB_TYPES.has(tab.type as SideTabType) &&
    typeof tab.label === "string" &&
    typeof tab.payload === "string" &&
    typeof tab.createdAt === "number"
  );
}

export function normalizeWorkspaceArtifacts(value: unknown): WorkspaceArtifacts {
  const input = value && typeof value === "object"
    ? (value as Partial<WorkspaceArtifacts>)
    : {};
  return {
    files: Array.isArray(input.files)
      ? input.files.filter((item): item is string => typeof item === "string").slice(0, 50)
      : [],
    services: Array.isArray(input.services)
      ? input.services.filter((item): item is string => typeof item === "string").slice(0, 50)
      : [],
  };
}

export function normalizeRestoredSideSession(row: SessionRow): SessionRow {
  const interrupted = row.status === "running" || row.status === "starting";
  return {
    ...row,
    kind: "side",
    status: interrupted ? (row.acp_session_id ? "ready" : "draft") : row.status,
    activeTurnId: undefined,
    queuedTurnIds: undefined,
    queuedPrompts: undefined,
    pendingAsks: undefined,
  };
}

export function normalizeRestoredTurn(turn: Turn): Turn {
  const interrupted = turn.status === "running" || turn.status === "queued";
  return {
    ...turn,
    events: Array.isArray(turn.events) ? turn.events.map((event) => ({ ...event })) : [],
    status: interrupted ? "cancelled" : turn.status,
    endedAt: interrupted ? turn.endedAt ?? Date.now() : turn.endedAt,
  };
}

export function isPersistedSubagentActivity(value: unknown): value is SubagentActivity {
  if (!value || typeof value !== "object") return false;
  const activity = value as Partial<SubagentActivity>;
  return (
    typeof activity.parentSessionId === "string" &&
    typeof activity.childSessionId === "string" &&
    typeof activity.viewSessionId === "string" &&
    typeof activity.avatarId === "string" &&
    typeof activity.task === "string" &&
    typeof activity.startedAt === "number" &&
    typeof activity.updatedAt === "number"
  );
}

export function subagentActivityLabel(activity: SubagentActivity): string {
  const name =
    activity.native?.nickname ||
    activity.task ||
    activity.native?.agentType ||
    activity.childSessionId;
  return name.length <= 24 ? name : name.slice(0, 23).trimEnd() + "…";
}
