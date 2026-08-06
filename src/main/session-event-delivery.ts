import type { SessionEventOut } from "../shared/session-events.js";
import { shouldPersistSessionEvent } from "./session-event-enricher.js";

type CanonicalSessionEvent = NonNullable<SessionEventOut["openma_event"]>;

export interface SessionEventDeliveryDeps {
  publish(message: SessionEventOut): void;
  persist(event: CanonicalSessionEvent): void;
  onPersistError?(error: unknown, event: CanonicalSessionEvent): void;
}

/** Live delivery is authoritative. Durable persistence runs only after the
 * GUI/pair route has accepted the event and cannot fail the live path. */
export function deliverSessionEvent(
  message: SessionEventOut,
  deps: SessionEventDeliveryDeps,
): void {
  deps.publish(message);
  const event = message.openma_event;
  if (!event || !shouldPersistSessionEvent(event)) return;
  try {
    deps.persist(event);
  } catch (error) {
    deps.onPersistError?.(error, event);
  }
}
