import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

/**
 * Finished renderer spans as they cross IPC to the main process. The main
 * process validates every field, attaches its own resource and feeds the
 * spans to the same processors as its own (local log, then OTLP export when
 * enabled). The renderer never sees the export endpoint or credentials.
 */

export type HrTimeWire = [seconds: number, nanos: number];
export type AttributeValueWire = string | number | boolean | Array<string | number | boolean>;
export type AttributesWire = Record<string, AttributeValueWire>;

export interface RendererSpanWire {
  name: string;
  /** OTel SpanKind enum value. */
  kind: number;
  traceId: string;
  spanId: string;
  traceFlags: number;
  parentSpanId?: string;
  startTime: HrTimeWire;
  endTime: HrTimeWire;
  attributes: AttributesWire;
  events: Array<{ name: string; time: HrTimeWire; attributes?: AttributesWire }>;
  /** OTel SpanStatusCode: 0 unset, 1 ok, 2 error. No message crosses. */
  statusCode: number;
  scope: string;
}

/** Bounds applied by the main process; anything beyond is dropped. */
export const RENDERER_SPAN_LIMITS = {
  spansPerBatch: 512,
  attributesPerSpan: 64,
  eventsPerSpan: 32,
  nameLength: 128,
  stringValueLength: 512,
} as const;

export const RENDERER_SERVICE_NAME = "backchat-renderer";

function attributesWire(attributes: Attributes): AttributesWire {
  const out: AttributesWire = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out[key] = value.filter((item): item is string | number | boolean => item !== null && item !== undefined);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function encodeSpan(span: ReadableSpan): RendererSpanWire {
  const { traceId, spanId, traceFlags } = span.spanContext();
  return {
    name: span.name,
    kind: span.kind,
    traceId,
    spanId,
    traceFlags,
    ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
    startTime: [span.startTime[0], span.startTime[1]],
    endTime: [span.endTime[0], span.endTime[1]],
    attributes: attributesWire(span.attributes),
    events: span.events.map((event) => ({
      name: event.name,
      time: [event.time[0], event.time[1]],
      ...(event.attributes ? { attributes: attributesWire(event.attributes) } : {}),
    })),
    statusCode: span.status.code,
    scope: span.instrumentationScope.name,
  };
}
