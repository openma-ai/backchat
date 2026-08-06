import { BracesIcon } from "lucide-react";
import { safeJson } from "@/lib/format";
import type { TurnEvent } from "@/lib/session-store";

type RawEventKind = "mcp-extension" | "vendor-raw";

export interface InspectableRawEvent {
  kind: RawEventKind;
  method: string;
  type: string;
  payload: unknown;
  status: string;
  error?: unknown;
}

const KNOWN_ACP_UPDATE_TYPES = new Set([
  "agent_message_chunk",
  "agent_thought_chunk",
  "available_commands_update",
  "config_option_update",
  "current_mode_update",
  "plan",
  "session_info_update",
  "tool_call",
  "tool_call_update",
  "usage_update",
]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function statusValue(payload: unknown): string {
  const record = recordValue(payload);
  return stringValue(record?.status) ?? stringValue(record?.phase) ?? "received";
}

function errorValue(payload: unknown): unknown {
  const record = recordValue(payload);
  return record?.error ?? record?.errorMessage ?? record?.error_message;
}

function isMcpExtension(type: string, method: string): boolean {
  return type === "acp.mcp_notification"
    || type.includes("mcp")
    || method.startsWith("mcp/");
}

function inspectPayload(payload: unknown): InspectableRawEvent | null {
  const outer = recordValue(payload);
  if (!outer) return null;

  if (outer.type === "vendor.event") {
    const vendor = recordValue(outer.data);
    if (vendor?.kind !== "vendor") return null;
    const method = stringValue(vendor.name) ?? "(unknown)";
    const type = stringValue(vendor.namespace) ?? "vendor.event";
    const data = vendor.data;
    return {
      kind: isMcpExtension(type, method) ? "mcp-extension" : "vendor-raw",
      method,
      type,
      payload: data,
      status: statusValue(data),
      error: errorValue(data),
    };
  }

  if (outer.type === "raw.event") {
    const raw = recordValue(outer.data);
    if (raw?.kind !== "raw") return null;
    const method = stringValue(raw.method) ?? "(unknown)";
    const type = stringValue(raw.event_type) ?? "raw.event";
    const data = raw.payload;
    return {
      kind: isMcpExtension(type, method) ? "mcp-extension" : "vendor-raw",
      method,
      type,
      payload: data,
      status: statusValue(data),
      error: errorValue(data),
    };
  }

  // Canonical OpenMA events already have an explicit semantic projection.
  // Only vendor.event/raw.event belong in this inspector; never downgrade a
  // known canonical event into a generic raw card.
  if (outer.schema === "oma.event.v1" || outer.schema_version === "oma.event.v1") {
    return null;
  }

  const inner = recordValue(outer.update) ?? outer;
  const type =
    stringValue(inner.type)
    ?? stringValue(inner.sessionUpdate)
    ?? stringValue(inner.event_type);
  if (!type) return null;

  const isExtension = type === "acp.extension_notification"
    || type === "acp.extension_request"
    || type === "acp.mcp_notification"
    || type.startsWith("_");
  if (!isExtension && KNOWN_ACP_UPDATE_TYPES.has(type)) return null;

  const method = stringValue(inner.method) ?? "session/update";
  const data = inner.params ?? inner.payload ?? inner;
  return {
    kind: isMcpExtension(type, method) ? "mcp-extension" : "vendor-raw",
    method,
    type,
    payload: data,
    status: statusValue(data),
    error: errorValue(data),
  };
}

export function inspectRawTurnEvents(events: readonly TurnEvent[]): InspectableRawEvent[] {
  return events.flatMap((event) => {
    const inspected = inspectPayload(event.payload);
    return inspected ? [inspected] : [];
  });
}

export function RawEventInspector({
  events,
}: {
  events: readonly InspectableRawEvent[];
}) {
  if (events.length === 0) return null;
  return (
    <section
      className="space-y-2 rounded-xl border border-border/45 bg-bg-surface/25 p-3"
      data-raw-event-inspector="true"
      aria-label="Raw protocol events"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        <BracesIcon className="size-3.5" aria-hidden="true" />
        Protocol events
      </div>
      {events.map((event, index) => (
        <article
          key={`${event.type}:${event.method}:${index}`}
          className="space-y-2 rounded-lg bg-bg/55 p-2 text-[11px]"
          data-raw-event-kind={event.kind}
          data-raw-event-method={event.method}
          data-raw-event-type={event.type}
          data-raw-event-status={event.status}
          data-raw-event-error={event.error === undefined ? "none" : "present"}
        >
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
            <dt className="text-fg-subtle">Method</dt>
            <dd className="min-w-0 break-all font-mono text-fg">{event.method}</dd>
            <dt className="text-fg-subtle">Type</dt>
            <dd className="min-w-0 break-all font-mono text-fg">{event.type}</dd>
            <dt className="text-fg-subtle">Status</dt>
            <dd className="min-w-0 break-all font-mono text-fg">{event.status}</dd>
            <dt className="text-fg-subtle">Error</dt>
            <dd className="min-w-0 break-all font-mono text-fg">
              {event.error === undefined ? "None" : safeJson(event.error)}
            </dd>
          </dl>
          <div>
            <div className="mb-1 text-fg-subtle">Payload</div>
            <pre
              className="max-h-64 overflow-auto rounded bg-bg-surface/55 p-2 font-mono whitespace-pre-wrap text-fg-muted"
              data-raw-event-payload="true"
            >
              {safeJson(event.payload) ?? "null"}
            </pre>
          </div>
        </article>
      ))}
    </section>
  );
}
