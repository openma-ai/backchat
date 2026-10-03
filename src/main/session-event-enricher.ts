import type { SessionEventOut } from "../shared/session-events.js";
import { attachOpenMAEvent } from "../shared/openma-event.js";
import { rememberedPermissionDecision } from "./permission-policy.js";
import { toolCallOutcome } from "../shared/tool-outcome.js";

export function hasOpenMAEventSchema(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as { schema?: unknown; schema_version?: unknown };
  return event.schema === "oma.event.v1"
    || event.schema_version === "oma.event.v1";
}

export function latestPersistedOpenMAEventSequence(
  rows: ReadonlyArray<{ type: string; data: string }>,
): number {
  let latest = 0;
  for (const row of rows) {
    if (row.type !== "openma_event") continue;
    try {
      const event = JSON.parse(row.data) as {
        schema?: unknown;
        schema_version?: unknown;
        seq?: unknown;
      };
      if (!hasOpenMAEventSchema(event)) continue;
      if (
        typeof event.seq === "number"
        && Number.isSafeInteger(event.seq)
        && event.seq >= 0
      ) {
        latest = Math.max(latest, event.seq);
      }
    } catch {
      // Legacy/malformed rows remain replay evidence but cannot seed the
      // canonical sequence clock.
    }
  }
  return latest;
}

const NEVER_PERSIST_EVENT_TYPES = new Set([
  "session.started",
  "turn.queued",
]);

const TURN_SCOPED_RUNTIME_EVENT_TYPES = new Set([
  "command_catalog.updated",
  "config.updated",
  "capability.updated",
  "session.running",
  "session.idle",
  "usage.updated",
  "raw.event",
  "vendor.event",
]);

/** Runtime snapshots are forwarded live but never appended to chat history.
 * Durable conversation facts remain replayable. Unknown raw/vendor updates
 * are retained only when they belong to a concrete turn. */
export function shouldPersistSessionEvent(
  event: NonNullable<SessionEventOut["openma_event"]>,
): boolean {
  if (NEVER_PERSIST_EVENT_TYPES.has(event.type)) return false;
  if (TURN_SCOPED_RUNTIME_EVENT_TYPES.has(event.type)) {
    return typeof event.turn_id === "string" && event.turn_id.length > 0;
  }
  return true;
}

function stampPermissionOutcome(message: SessionEventOut): SessionEventOut {
  const event = message.openma_event;
  if (!event) return message;
  if (event.type !== "tool.completed" && event.type !== "tool.failed" && event.type !== "tool.cancelled") {
    return message;
  }
  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {};
  const toolCallId = typeof data.tool_call_id === "string" ? data.tool_call_id : undefined;
  const decision = rememberedPermissionDecision(message.session_id, toolCallId);
  if (!decision) return message;
  const outcome = toolCallOutcome({
    status: typeof data.status === "string"
      ? data.status
      : event.type === "tool.cancelled" ? "cancelled" : "completed",
    rawOutput: data.raw_output,
    content: data.content,
    error: data.error,
    permission_outcome: decision.outcome,
    option_kind: decision.optionKind,
    option_id: decision.optionId,
  });
  if (!outcome || outcome === "ok" || outcome === "finished") return message;
  return {
    ...message,
    openma_event: {
      ...event,
      type: outcome === "cancelled" ? "tool.cancelled" : "tool.failed",
      data: {
        ...data,
        outcome,
        status: outcome === "cancelled" ? "cancelled" : "failed",
        ...(outcome === "denied" ? { reason: data.reason ?? "denied" } : {}),
      },
    },
  };
}

export function createSessionEventEnricher(
  now: () => string,
  initialSequenceForSession: (sessionId: string) => number = () => 0,
): (message: SessionEventOut) => SessionEventOut {
  const harnessBySessionId = new Map<string, string>();
  const sequenceBySessionId = new Map<string, number>();

  return (message) => {
    const previousSequence = sequenceBySessionId.get(message.session_id)
      ?? Math.max(0, initialSequenceForSession(message.session_id));
    const attachedSequence = message.openma_event?.seq;
    const sequence = Math.max(
      previousSequence + 1,
      typeof attachedSequence === "number"
        && Number.isSafeInteger(attachedSequence)
        && attachedSequence >= 0
        ? attachedSequence
        : 0,
    );
    sequenceBySessionId.set(message.session_id, sequence);
    if (message.type === "session.ready") {
      harnessBySessionId.set(message.session_id, message.agent_id);
    }
    const attached = message.openma_event
      ? message
      : attachOpenMAEvent(message, {
          occurredAt: now(),
          harness: harnessBySessionId.get(message.session_id),
          adapter: "acp",
        });
    const sequenced = attached.openma_event
      ? {
          ...attached,
          openma_event: {
            ...attached.openma_event,
            ...(!message.openma_event
              ? { event_id: `${attached.openma_event.event_id}:seq:${sequence}` }
              : {}),
            seq: sequence,
          },
        }
      : attached;
    const enriched = stampPermissionOutcome(sequenced);

    if (message.type === "session.disposed") {
      harnessBySessionId.delete(message.session_id);
      sequenceBySessionId.delete(message.session_id);
    }
    return enriched;
  };
}
