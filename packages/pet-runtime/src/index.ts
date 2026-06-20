export type PetSignalSource = string;

export interface PetSignal {
  id: string;
  source: PetSignalSource;
  name: string;
  ts?: number;
  sessionId?: string;
  turnId?: string;
  agentId?: string;
  labels?: Record<string, string>;
  payload?: unknown;
}

export type PetPriority = "low" | "normal" | "high" | "urgent";
export type PetIntensity = "low" | "medium" | "high";
export type PetTone = "quiet" | "helpful" | "excited" | "warning";

export type PetMotion =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review"
  | "wake"
  | "listen"
  | "think"
  | "speak"
  | "tool-read"
  | "tool-edit"
  | "tool-run"
  | "tool-search"
  | "tool-fetch"
  | "tool-other"
  | "ask"
  | "wait"
  | "handoff"
  | "celebrate"
  | "warn"
  | "sleep"
  | "nudge";

export type PetAction =
  | {
      type: "motion";
      motion: PetMotion;
      intensity: PetIntensity;
      priority: PetPriority;
      source?: string;
      reason?: string;
      sessionId?: string;
      turnId?: string;
      label?: string;
      proactive?: boolean;
      durationMs?: number;
    }
  | {
      type: "speech";
      text: string;
      tone: PetTone;
      priority: PetPriority;
      source?: string;
      sessionId?: string;
      turnId?: string;
      proactive?: boolean;
      ttlMs?: number;
    }
  | {
      type: "emit";
      target: string;
      event: string;
      priority: PetPriority;
      payload?: unknown;
      proactive?: boolean;
    };

export interface PetRuntimeState {
  readonly signalCount: number;
  readonly lastSignal: PetSignal | null;
}

export interface PetHook {
  id: string;
  priority?: number;
  when(signal: PetSignal, state: PetRuntimeState): boolean;
  run(signal: PetSignal, state: PetRuntimeState): PetAction | readonly PetAction[] | null | undefined;
}

export interface PetProactivityPolicy {
  allow(action: PetAction, now: number): boolean;
}

export interface QuietProactivityPolicyOptions {
  minIntervalMs: number;
  windowMs: number;
  maxPerWindow: number;
}

export interface PetRuntimeOptions {
  hooks?: readonly PetHook[];
  proactive?: PetProactivityPolicy;
  now?: () => number;
}

export interface PetRuntime {
  dispatch(input: PetSignal | BackchatSessionEventLike): PetAction[];
  state(): PetRuntimeState;
}

export type BackchatSessionEventLike =
  | {
      type: "session.ready";
      session_id: string;
      acp_session_id: string;
      agent_id: string;
      cwd: string;
    }
  | {
      type: "session.event";
      session_id: string;
      turn_id: string;
      event: unknown;
    }
  | {
      type: "session.complete";
      session_id: string;
      turn_id: string;
    }
  | {
      type: "session.error";
      session_id: string;
      turn_id?: string;
      message: string;
    }
  | {
      type: "session.disposed";
      session_id: string;
    };

export function createPetRuntime(options: PetRuntimeOptions = {}): PetRuntime {
  const hooks = [...(options.hooks ?? [])].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
  const now = options.now ?? Date.now;
  let signalCount = 0;
  let lastSignal: PetSignal | null = null;

  const state = (): PetRuntimeState => ({
    signalCount,
    lastSignal,
  });

  return {
    dispatch(input) {
      const signals = isPetSignal(input) ? [input] : normalizeBackchatSessionEvent(input);
      const out: PetAction[] = [];
      for (const signal of signals) {
        signalCount += 1;
        lastSignal = signal;
        const currentState = state();
        for (const hook of hooks) {
          if (!hook.when(signal, currentState)) continue;
          const next = hook.run(signal, currentState);
          const actions = Array.isArray(next) ? next : next ? [next] : [];
          for (const action of actions) {
            if (action.proactive && options.proactive && !options.proactive.allow(action, now())) {
              continue;
            }
            out.push(action);
          }
        }
      }
      return out;
    },
    state,
  };
}

export function createQuietProactivityPolicy(
  options: QuietProactivityPolicyOptions,
): PetProactivityPolicy {
  const acceptedAt: number[] = [];
  return {
    allow(_action, now) {
      const windowStart = now - options.windowMs;
      while (acceptedAt.length > 0 && acceptedAt[0]! < windowStart) {
        acceptedAt.shift();
      }
      const last = acceptedAt.at(-1);
      if (last !== undefined && now - last < options.minIntervalMs) {
        return false;
      }
      if (acceptedAt.length >= options.maxPerWindow) {
        return false;
      }
      acceptedAt.push(now);
      return true;
    },
  };
}

export function defaultPetHooks(): PetHook[] {
  return [
    {
      id: "backchat-session-ready",
      when: (signal) => signal.name === "session.ready",
      run: (signal) =>
        motion(signal, "wake", "low", "normal", "session.ready", signal.labels?.["agentId"]),
    },
    {
      id: "backchat-session-complete",
      when: (signal) => signal.name === "session.complete",
      run: (signal) => motion(signal, "celebrate", "low", "normal", "session.complete"),
    },
    {
      id: "backchat-session-error",
      priority: 10,
      when: (signal) => signal.name === "session.error",
      run: (signal) => {
        const actions: PetAction[] = [
          motion(signal, "warn", "high", "urgent", "session.error", signal.labels?.["message"]),
        ];
        if (signal.labels?.["message"]) {
          actions.push({
            type: "speech",
            text: signal.labels["message"],
            tone: "warning",
            priority: "high",
            source: signal.source,
            sessionId: signal.sessionId,
            turnId: signal.turnId,
            ttlMs: 8_000,
          });
        }
        return actions;
      },
    },
    {
      id: "backchat-session-disposed",
      when: (signal) => signal.name === "session.disposed",
      run: (signal) => motion(signal, "sleep", "low", "low", "session.disposed"),
    },
    {
      id: "acp-agent-message",
      when: (signal) => signal.name === "agent_message_chunk",
      run: (signal) => motion(signal, "speak", "low", "low", "agent_message_chunk"),
    },
    {
      id: "acp-agent-thought",
      when: (signal) => signal.name === "agent_thought_chunk" || signal.name === "plan",
      run: (signal) => motion(signal, "think", "medium", "normal", signal.name),
    },
    {
      id: "acp-tool-call",
      priority: 5,
      when: (signal) => signal.name === "tool_call" || signal.name === "tool_call_update",
      run: (signal) => {
        const status = signal.labels?.["toolStatus"];
        if (status === "completed") {
          return motion(signal, "celebrate", "low", "normal", "tool_call:completed", signal.labels?.["title"]);
        }
        if (status === "failed") {
          return motion(signal, "warn", "high", "urgent", "tool_call:failed", signal.labels?.["title"]);
        }
        if (status === "cancelled") {
          return motion(signal, "idle", "low", "low", "tool_call:cancelled", signal.labels?.["title"]);
        }
        const toolKind = signal.labels?.["toolKind"] ?? "other";
        return motion(
          signal,
          toolMotion(toolKind),
          "medium",
          "normal",
          `tool_call:${toolKind}`,
          signal.labels?.["title"],
        );
      },
    },
    {
      id: "acp-request-permission",
      priority: 20,
      when: (signal) => signal.name === "requestPermission",
      run: (signal) =>
        motion(signal, "ask", "high", "urgent", "requestPermission", signal.labels?.["title"]),
    },
    {
      id: "acp-config-or-commands",
      when: (signal) =>
        signal.name === "config_option_update" ||
        signal.name === "available_commands_update" ||
        signal.name === "current_mode_update",
      run: (signal) => motion(signal, "listen", "low", "low", signal.name),
    },
  ];
}

export function normalizeBackchatSessionEvent(event: BackchatSessionEventLike): PetSignal[] {
  if (event.type === "session.event") {
    const payload = event.event;
    if (!isRecord(payload)) return [];

    const acpName = readString(payload, "sessionUpdate") ?? readString(payload, "type");
    if (!acpName) return [];

    const labels = compactLabels({
      toolCallId: readString(payload, "toolCallId"),
      toolKind: readString(payload, "kind"),
      toolStatus: readString(payload, "status"),
      title: readString(payload, "title") ?? readPermissionTitle(payload),
    });
    const suffix = labels["toolCallId"] ? `${acpName}:${labels["toolCallId"]}` : acpName;

    return [
      compactSignal({
        id: `backchat:${event.session_id}:${event.turn_id}:${suffix}`,
        source: "backchat.acp",
        name: acpName,
        sessionId: event.session_id,
        turnId: event.turn_id,
        labels,
        payload,
      }),
    ];
  }

  const labels = compactLabels({
    message: event.type === "session.error" ? event.message : undefined,
    agentId: event.type === "session.ready" ? event.agent_id : undefined,
    acpSessionId: event.type === "session.ready" ? event.acp_session_id : undefined,
    cwd: event.type === "session.ready" ? event.cwd : undefined,
  });
  const turnId = "turn_id" in event ? event.turn_id : undefined;

  return [
    compactSignal({
      id: turnId
        ? `backchat:${event.session_id}:${turnId}:${event.type}`
        : `backchat:${event.session_id}:${event.type}`,
      source: "backchat.session",
      name: event.type,
      sessionId: event.session_id,
      turnId,
      labels,
      payload: event,
    }),
  ];
}

function motion(
  signal: PetSignal,
  petMotion: PetMotion,
  intensity: PetIntensity,
  priority: PetPriority,
  reason: string,
  label?: string,
): PetAction {
  const action: PetAction = {
    type: "motion",
    motion: petMotion,
    intensity,
    priority,
    source: signal.source,
    reason,
  };
  if (signal.sessionId !== undefined) action.sessionId = signal.sessionId;
  if (signal.turnId !== undefined) action.turnId = signal.turnId;
  if (label !== undefined) action.label = label;
  return action;
}

function toolMotion(kind: string): PetMotion {
  switch (kind) {
    case "read":
      return "tool-read";
    case "edit":
    case "delete":
    case "move":
      return "tool-edit";
    case "execute":
      return "tool-run";
    case "search":
      return "tool-search";
    case "fetch":
      return "tool-fetch";
    case "think":
      return "think";
    default:
      return "tool-other";
  }
}

function compactSignal(signal: PetSignal): PetSignal {
  const out: PetSignal = {
    id: signal.id,
    source: signal.source,
    name: signal.name,
  };
  if (signal.ts !== undefined) out.ts = signal.ts;
  if (signal.sessionId !== undefined) out.sessionId = signal.sessionId;
  if (signal.turnId !== undefined) out.turnId = signal.turnId;
  if (signal.agentId !== undefined) out.agentId = signal.agentId;
  if (signal.labels && Object.keys(signal.labels).length > 0) out.labels = signal.labels;
  if (signal.payload !== undefined) out.payload = signal.payload;
  return out;
}

function compactLabels(labels: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value !== undefined && value.length > 0) out[key] = value;
  }
  return out;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readPermissionTitle(record: Record<string, unknown>): string | undefined {
  const params = record["params"];
  if (!isRecord(params)) return undefined;
  const toolCall = params["toolCall"];
  if (!isRecord(toolCall)) return undefined;
  return readString(toolCall, "title");
}

function isPetSignal(value: unknown): value is PetSignal {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["source"] === "string" &&
    typeof value["name"] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
