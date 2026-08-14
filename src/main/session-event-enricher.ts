import type { SessionEventOut } from "../shared/session-events.js";
import { attachOpenMAEvent } from "../shared/openma-event.js";

export function latestPersistedOpenMAEventSequence(
  rows: ReadonlyArray<{ type: string; data: string }>,
): number {
  let latest = 0;
  for (const row of rows) {
    if (row.type !== "openma_event") continue;
    try {
      const event = JSON.parse(row.data) as {
        schema_version?: unknown;
        seq?: unknown;
      };
      if (event.schema_version !== "oma.event.v1") continue;
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

export function createSessionEventEnricher(
  now: () => string,
  persistEvent?: (
    event: NonNullable<SessionEventOut["openma_event"]>,
  ) => void,
  initialSequenceForSession: (sessionId: string) => number = () => 0,
): (message: SessionEventOut) => SessionEventOut {
  const harnessBySessionId = new Map<string, string>();
  const sessionSetupMetaBySessionId = new Map<
    string,
    Record<string, unknown> | null
  >();
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
      sessionSetupMetaBySessionId.set(
        message.session_id,
        message.session_setup_meta ?? null,
      );
    }
    const attached = message.openma_event
      ? message
      : attachOpenMAEvent(message, {
          occurredAt: now(),
          harness: harnessBySessionId.get(message.session_id),
          adapter: "acp",
          sessionSetupMeta: sessionSetupMetaBySessionId.get(message.session_id),
        });
    const enriched = attached.openma_event
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

    if (enriched.openma_event) persistEvent?.(enriched.openma_event);

    if (message.type === "session.disposed") {
      harnessBySessionId.delete(message.session_id);
      sessionSetupMetaBySessionId.delete(message.session_id);
      sequenceBySessionId.delete(message.session_id);
    }
    return enriched;
  };
}
