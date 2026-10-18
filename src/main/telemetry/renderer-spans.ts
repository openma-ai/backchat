import { TraceFlags, type Attributes, type HrTime, type SpanContext } from "@opentelemetry/api";
import { resourceFromAttributes, type Resource } from "@opentelemetry/resources";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";

import {
  RENDERER_SERVICE_NAME,
  RENDERER_SPAN_LIMITS as LIMITS,
  type AttributesWire,
  type HrTimeWire,
  type RendererSpanWire,
} from "../../shared/telemetry.js";

/**
 * Decode finished renderer spans received over IPC into SDK `ReadableSpan`s.
 * The renderer is untrusted input: malformed spans are dropped, collections
 * are capped, long strings are truncated, and the resource is the main
 * process's, not anything the renderer claims.
 */

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hrTime(value: unknown): HrTime | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [seconds, nanos] = value as unknown[];
  if (typeof seconds !== "number" || typeof nanos !== "number") return undefined;
  if (!Number.isSafeInteger(seconds) || seconds < 0) return undefined;
  if (!Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return undefined;
  return [seconds, nanos];
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

function scalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") return value.slice(0, LIMITS.stringValueLength);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}

function attributes(value: unknown): Attributes {
  const out: Attributes = {};
  if (!isRecord(value)) return out;
  let count = 0;
  for (const [key, raw] of Object.entries(value as AttributesWire)) {
    if (count >= LIMITS.attributesPerSpan) break;
    if (!key || key.length > LIMITS.nameLength) continue;
    if (Array.isArray(raw)) {
      const items = raw.map(scalar).filter((item) => item !== undefined);
      out[key] = items as string[];
    } else {
      const item = scalar(raw);
      if (item === undefined) continue;
      out[key] = item;
    }
    count += 1;
  }
  return out;
}

function duration(start: HrTime, end: HrTime): HrTime {
  let seconds = end[0] - start[0];
  let nanos = end[1] - start[1];
  if (nanos < 0) {
    seconds -= 1;
    nanos += 1e9;
  }
  return [seconds, nanos];
}

function isAfter(end: HrTimeWire, start: HrTimeWire): boolean {
  return end[0] > start[0] || (end[0] === start[0] && end[1] >= start[1]);
}

function decodeSpan(raw: unknown, resource: Resource): ReadableSpan | undefined {
  if (!isRecord(raw)) return undefined;
  const name = text(raw.name, LIMITS.nameLength);
  const scope = text(raw.scope, LIMITS.nameLength);
  const traceId = typeof raw.traceId === "string" && TRACE_ID.test(raw.traceId) ? raw.traceId : undefined;
  const spanId = typeof raw.spanId === "string" && SPAN_ID.test(raw.spanId) ? raw.spanId : undefined;
  const startTime = hrTime(raw.startTime);
  const endTime = hrTime(raw.endTime);
  if (!name || !scope || !traceId || !spanId || !startTime || !endTime) return undefined;
  if (!isAfter(endTime, startTime)) return undefined;
  const kind = typeof raw.kind === "number" && Number.isInteger(raw.kind) && raw.kind >= 0 && raw.kind <= 4 ? raw.kind : 0;
  const statusCode = raw.statusCode === 1 || raw.statusCode === 2 ? raw.statusCode : 0;
  const traceFlags = raw.traceFlags === TraceFlags.SAMPLED ? TraceFlags.SAMPLED : TraceFlags.NONE;
  const parentSpanId = typeof raw.parentSpanId === "string" && SPAN_ID.test(raw.parentSpanId) ? raw.parentSpanId : undefined;
  const context: SpanContext = { traceId, spanId, traceFlags };
  const events = (Array.isArray(raw.events) ? raw.events : [])
    .slice(0, LIMITS.eventsPerSpan)
    .flatMap((event: unknown) => {
      if (!isRecord(event)) return [];
      const eventName = text(event.name, LIMITS.nameLength);
      const time = hrTime(event.time);
      if (!eventName || !time) return [];
      return [{ name: eventName, time, attributes: attributes(event.attributes) }];
    });
  return {
    name,
    kind,
    spanContext: () => context,
    ...(parentSpanId ? { parentSpanContext: { traceId, spanId: parentSpanId, traceFlags, isRemote: false } } : {}),
    startTime,
    endTime,
    duration: duration(startTime, endTime),
    ended: true,
    status: { code: statusCode },
    attributes: attributes(raw.attributes),
    links: [],
    events,
    resource,
    instrumentationScope: { name: scope },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

export function createRendererSpanDecoder(serviceVersion?: string): (batch: unknown) => ReadableSpan[] {
  const resource = resourceFromAttributes({
    "service.name": RENDERER_SERVICE_NAME,
    ...(serviceVersion ? { "service.version": serviceVersion } : {}),
  });
  return (batch) => {
    if (!Array.isArray(batch)) return [];
    return batch
      .slice(0, LIMITS.spansPerBatch)
      .map((raw) => decodeSpan(raw, resource))
      .filter((span): span is ReadableSpan => span !== undefined);
  };
}
