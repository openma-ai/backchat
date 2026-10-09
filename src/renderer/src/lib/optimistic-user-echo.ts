import type { Turn } from "./session-types";

/** A user send painted before any IPC or ACP round-trip returns. */
export interface OptimisticUserEcho {
  /** Stable id sent with the request and stored on the persisted event. */
  clientId: string;
  text: string;
  createdAt: number;
  state: "pending" | "failed";
  error?: string;
}

export function insertOptimisticEcho(
  echoes: readonly OptimisticUserEcho[],
  echo: OptimisticUserEcho,
): OptimisticUserEcho[] {
  return [
    ...echoes.filter((item) => item.clientId !== echo.clientId),
    echo,
  ];
}

export function failOptimisticEcho(
  echoes: readonly OptimisticUserEcho[],
  clientId: string,
  error: string,
): OptimisticUserEcho[] {
  let changed = false;
  const next = echoes.map((echo) => {
    if (echo.clientId !== clientId) return echo;
    changed = true;
    return { ...echo, state: "failed" as const, error };
  });
  return changed ? next : echoes as OptimisticUserEcho[];
}

/** Retry keeps the same client id so a duplicate host command reconciles instead of doubling. */
export function reopenOptimisticEcho(
  echoes: readonly OptimisticUserEcho[],
  clientId: string,
): OptimisticUserEcho[] {
  let changed = false;
  const next = echoes.map((echo) => {
    if (echo.clientId !== clientId) return echo;
    changed = true;
    return { ...echo, state: "pending" as const, error: undefined };
  });
  return changed ? next : echoes as OptimisticUserEcho[];
}

/**
 * Drop echoes whose client id is already on a persisted turn or event.
 * Same text with a different client id stays — the user can send it twice.
 */
export function reconcileOptimisticEchoes(
  echoes: readonly OptimisticUserEcho[],
  persistedClientIds: ReadonlySet<string>,
): readonly OptimisticUserEcho[] {
  if (persistedClientIds.size === 0) return echoes;
  const next = echoes.filter((echo) => !persistedClientIds.has(echo.clientId));
  return next.length === echoes.length ? echoes : next;
}

export function persistedClientIds(
  turns: readonly Pick<Turn, "clientId">[],
): Set<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    if (turn.clientId) ids.add(turn.clientId);
  }
  return ids;
}

/** `${projectId}:message:${commandId}` is the durable project user event. */
export function projectMessageClientId(
  projectId: string,
  eventId: string | undefined,
): string | undefined {
  const prefix = `${projectId}:message:`;
  if (!eventId?.startsWith(prefix)) return undefined;
  const clientId = eventId.slice(prefix.length);
  return clientId || undefined;
}

export function clientIdFromUserEvent(
  event: {
    id?: string;
    event_id?: string;
    turn_id?: string;
    type?: string;
    data?: unknown;
    payload?: unknown;
  },
  scope?: { projectId?: string; sessionId?: string },
): string | undefined {
  const record = isRecord(event.data)
    ? event.data
    : isRecord(event.payload)
      ? event.payload
      : undefined;
  const explicit = record?.client_id ?? record?.clientId;
  if (typeof explicit === "string" && explicit) return explicit;
  const id = event.id ?? event.event_id;
  if (scope?.projectId) {
    const fromProject = projectMessageClientId(scope.projectId, id);
    if (fromProject) return fromProject;
  }
  if (scope?.sessionId && id?.startsWith(`user-message:${scope.sessionId}:`)) {
    const clientId = id.slice(`user-message:${scope.sessionId}:`.length);
    return clientId || undefined;
  }
  if (event.type === "user.message" && event.turn_id) return event.turn_id;
  return undefined;
}

/** Append echoes the persisted transcript does not already represent. */
export function mergeOptimisticEchoes(
  turns: readonly Turn[],
  echoes: readonly OptimisticUserEcho[],
  sessionId?: string,
): readonly Turn[] {
  const known = persistedClientIds(turns);
  const pending = reconcileOptimisticEchoes(echoes, known);
  if (pending.length === 0) return turns;
  const fallbackSession = sessionId || turns.at(-1)?.sessionId || "optimistic";
  return [
    ...turns,
    ...pending.map((echo) => optimisticEchoToTurn(echo, fallbackSession)),
  ];
}

export function optimisticEchoToTurn(
  echo: OptimisticUserEcho,
  sessionId: string,
): Turn {
  return {
    id: `echo:${echo.clientId}`,
    clientId: echo.clientId,
    sessionId,
    promptText: echo.text,
    events: [],
    assistantText: "",
    thoughtText: "",
    status: echo.state === "failed" ? "error" : "unknown",
    sendState: echo.state,
    sendError: echo.error,
    errorMessage: echo.error,
    startedAt: echo.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
