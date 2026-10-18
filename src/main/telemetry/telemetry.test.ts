import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureAppLog, flushAppLog } from "../app-log.js";
import { rendererSettings } from "../renderer-settings.js";
import { encodeSpan, RENDERER_SPAN_LIMITS } from "../../shared/telemetry.js";
import { createOtlpTraceExporter, withoutOtlpEnvOverrides } from "./exporters.js";
import { describeResolution, installMainTelemetry, TELEMETRY_ENABLE_KEY } from "./index.js";
import { createMainTelemetry, SpanLogProcessor, SwitchableSpanProcessor } from "./pipeline.js";
import { createRendererSpanDecoder } from "./renderer-spans.js";


const roots: string[] = [];
afterEach(async () => {
  configureAppLog(null);
  trace.disable();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function logRecords(fn: (root: string) => Promise<void>): Promise<Array<Record<string, unknown>>> {
  const root = await mkdtemp(join(tmpdir(), "backchat-telemetry-"));
  roots.push(root);
  configureAppLog(root);
  await fn(root);
  await flushAppLog();
  const raw = await readFile(join(root, "logs", "backchat.log"), "utf8").catch(() => "");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

const ENABLED = { enabled: true as const, endpoint: "http://collector:4318/v1/traces", protocol: "http/json" as const, headers: { authorization: "Bearer secret" }, sources: {} };

describe("main telemetry pipeline", () => {
  it("writes every span locally and exports only while export is on", async () => {
    const local: string[] = [];
    const exported = new InMemorySpanExporter();
    const telemetry = createMainTelemetry({
      emitSpan: (span) => local.push(span.name),
      createExporter: () => exported,
      register: false,
      serviceVersion: "1.2.3",
    });
    const tracer = telemetry.provider.getTracer("test");
    tracer.startSpan("before").end();
    await telemetry.applyExport(ENABLED);
    expect(telemetry.exporting).toBe(true);
    tracer.startSpan("during").end();
    await telemetry.provider.forceFlush();
    expect(exported.getFinishedSpans().map((span) => span.name)).toEqual(["during"]);
    expect(exported.getFinishedSpans()[0]?.resource.attributes).toMatchObject({
      "service.name": "backchat-main",
      "service.version": "1.2.3",
    });
    await telemetry.applyExport({ enabled: false, reason: "telemetry_disabled", sources: {} });
    expect(telemetry.exporting).toBe(false);
    tracer.startSpan("after").end();
    expect(local).toEqual(["before", "during", "after"]);
    await telemetry.shutdown();
  });

  it("feeds ingested spans to the same processors", async () => {
    const local: string[] = [];
    const exported = new InMemorySpanExporter();
    const telemetry = createMainTelemetry({ emitSpan: (span) => local.push(span.name), createExporter: () => exported, register: false });
    await telemetry.applyExport(ENABLED);
    const decode = createRendererSpanDecoder();
    telemetry.ingest(decode([rendererSpan()]));
    await telemetry.provider.forceFlush();
    expect(local).toEqual(["ui.prompt.send"]);
    // Provider forceFlush reaches the export slot's batch processor.
    expect(exported.getFinishedSpans().map((span) => [span.name, span.resource.attributes["service.name"]]))
      .toEqual([["ui.prompt.send", "backchat-renderer"]]);
    await telemetry.shutdown();
  });

  it("never lets a local summary failure reach the traced code", () => {
    const processor = new SpanLogProcessor(() => {
      throw new Error("disk full");
    });
    expect(() => processor.onEnd({} as ReadableSpan)).not.toThrow();
  });

  it("swaps the export processor and shuts the old one down", async () => {
    const slot = new SwitchableSpanProcessor();
    const first = { onStart: vi.fn(), onEnd: vi.fn(), forceFlush: vi.fn(async () => undefined), shutdown: vi.fn(async () => undefined) };
    await slot.replace(first);
    slot.onEnd({} as ReadableSpan);
    await slot.forceFlush();
    await slot.shutdown();
    expect(first.onEnd).toHaveBeenCalledOnce();
    expect(first.forceFlush).toHaveBeenCalledOnce();
    expect(first.shutdown).toHaveBeenCalledOnce();
    expect(slot.active).toBe(false);
    await expect(slot.forceFlush()).resolves.toBeUndefined();
  });
});

describe("OTLP exporter construction", () => {
  it("hides OTLP endpoint and header variables only while constructing", () => {
    const env: NodeJS.ProcessEnv = {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://env",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=env",
      OTEL_SERVICE_NAME: "kept",
    };
    const seen = withoutOtlpEnvOverrides(() => ({ ...env }), env);
    expect(seen).toEqual({ OTEL_SERVICE_NAME: "kept" });
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://env");
    expect(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS).toBe("authorization=env");
  });

  it("builds the exporter for the resolved protocol with explicit url and headers", () => {
    const created: unknown[] = [];
    const fake = (config: unknown) => {
      created.push(config);
      return {} as SpanExporter;
    };
    createOtlpTraceExporter(ENABLED, { "http/json": fake, "http/protobuf": () => { throw new Error("wrong"); } });
    expect(created).toEqual([{ url: ENABLED.endpoint, headers: ENABLED.headers }]);
    expect(createOtlpTraceExporter({ ...ENABLED, protocol: "http/protobuf" })).toBeDefined();
  });
});

function rendererSpan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "ui.prompt.send",
    kind: 0,
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    traceFlags: 1,
    parentSpanId: "00f067aa0ba902b7",
    startTime: [1_760_000_000, 100],
    endTime: [1_760_000_001, 50],
    attributes: { "backchat.prompt.chars": 12, list: ["a", 1, true, null], bad: { nested: 1 }, nan: Number.NaN },
    events: [{ name: "e", time: [1_760_000_000, 500], attributes: { n: 1 } }, { name: "", time: [0, 0] }, "junk"],
    statusCode: 2,
    scope: "backchat.renderer",
    ...overrides,
  };
}

function tracedSpans() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer("backchat.renderer"), spans: () => exporter.getFinishedSpans() };
}

function setupSpan(): ReadableSpan {
  const { tracer, spans } = tracedSpans();
  tracer.startSpan("x").end();
  return spans()[0]!;
}

describe("renderer span wire encoding", () => {
  it("survives the IPC hop with ids, parent, timing, attributes and status", () => {
    const { tracer, spans } = tracedSpans();
    const parent = tracer.startSpan("ui.prompt.send");
    const child = tracer.startSpan("child", { attributes: { n: 1, list: ["a", "b"] } }, trace.setSpan(context.active(), parent));
    child.addEvent("mark", { k: true });
    child.setStatus({ code: SpanStatusCode.ERROR });
    child.end();
    parent.end();
    const [encodedChild] = spans().map(encodeSpan);
    const [decoded] = createRendererSpanDecoder()([JSON.parse(JSON.stringify(encodedChild))]);
    const original = spans()[0]!;
    expect(decoded?.spanContext()).toEqual(original.spanContext());
    expect(decoded?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(decoded?.startTime).toEqual(original.startTime);
    expect(decoded?.endTime).toEqual(original.endTime);
    expect(decoded?.attributes).toEqual({ n: 1, list: ["a", "b"] });
    expect(decoded?.events.map((event) => [event.name, event.attributes])).toEqual([["mark", { k: true }]]);
    expect(decoded?.status.code).toBe(SpanStatusCode.ERROR);
    expect(encodeSpan(spans()[1]!).parentSpanId).toBeUndefined();
  });

  it("drops undefined attribute values and null array items when encoding", () => {
    const base = setupSpan();
    const encoded = encodeSpan({
      name: base.name,
      kind: base.kind,
      spanContext: () => base.spanContext(),
      startTime: base.startTime,
      endTime: base.endTime,
      status: base.status,
      instrumentationScope: base.instrumentationScope,
      attributes: { gone: undefined, list: ["a", null, undefined, 2] as never },
      events: [{ name: "bare", time: [1, 0] }],
    } as unknown as ReadableSpan);
    expect(encoded.attributes).toEqual({ list: ["a", 2] });
    expect(encoded.events).toEqual([{ name: "bare", time: [1, 0] }]);
  });

});

describe("renderer span decoding", () => {
  const decode = createRendererSpanDecoder("9.9.9");

  it("rebuilds a ReadableSpan under the main process's renderer resource", () => {
    const [span] = decode([rendererSpan({ resource: { "service.name": "spoofed" } })]);
    expect(span?.name).toBe("ui.prompt.send");
    expect(span?.spanContext()).toEqual({ traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: 1 });
    expect(span?.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
    expect(span?.duration).toEqual([0, 999_999_950]);
    expect(span?.status.code).toBe(2);
    expect(span?.attributes).toEqual({ "backchat.prompt.chars": 12, list: ["a", 1, true] });
    expect(span?.events).toEqual([{ name: "e", time: [1_760_000_000, 500], attributes: { n: 1 } }]);
    expect(span?.resource.attributes).toMatchObject({ "service.name": "backchat-renderer", "service.version": "9.9.9" });
    expect(span?.instrumentationScope).toEqual({ name: "backchat.renderer" });
  });

  it.each([
    ["a bad trace id", { traceId: "xyz" }],
    ["a bad span id", { spanId: "1" }],
    ["no name", { name: "" }],
    ["no scope", { scope: 3 }],
    ["a malformed start", { startTime: [1, 2, 3] }],
    ["a negative time", { startTime: [-1, 0] }],
    ["out-of-range nanos", { endTime: [1_760_000_001, 1e9] }],
    ["non-numeric time", { endTime: ["1", 0] }],
    ["an end before its start", { endTime: [1_759_999_999, 0] }],
  ])("drops a span with %s", (_label, overrides) => {
    expect(decode([rendererSpan(overrides)])).toEqual([]);
  });

  it("normalises unknown enums and caps every collection", () => {
    const [span] = decode([rendererSpan({ kind: 9, statusCode: 7, traceFlags: 3, parentSpanId: "nope", events: "x", attributes: "x" })]);
    expect(span?.kind).toBe(0);
    expect(span?.status.code).toBe(0);
    expect(span?.spanContext().traceFlags).toBe(0);
    expect(span?.parentSpanContext).toBeUndefined();
    expect(span?.events).toEqual([]);
    expect(span?.attributes).toEqual({});

    const many = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, "v".repeat(2000)]));
    const [capped] = decode([rendererSpan({ attributes: { "": 1, ["x".repeat(200)]: 1, ...many } })]);
    expect(Object.keys(capped!.attributes)).toHaveLength(RENDERER_SPAN_LIMITS.attributesPerSpan);
    expect(String(capped!.attributes.k0)).toHaveLength(RENDERER_SPAN_LIMITS.stringValueLength);
    expect(decode(Array.from({ length: 600 }, () => rendererSpan()))).toHaveLength(RENDERER_SPAN_LIMITS.spansPerBatch);
    expect(decode("not a batch")).toEqual([]);
    expect(decode([null, 1])).toEqual([]);
    const [sameSecond] = decode([rendererSpan({ startTime: [5, 900], endTime: [5, 950] })]);
    expect(sameSecond?.duration).toEqual([0, 50]);
  });
});

describe("installed main telemetry", () => {
  it("logs the export decision without credentials and re-applies only on change", async () => {
    const created: unknown[] = [];
    const records = await logRecords(async () => {
      const installed = installMainTelemetry({
        env: { [TELEMETRY_ENABLE_KEY]: "1", OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20secret" },
        settings: {},
        pipeline: {
          register: false,
          createExporter: (resolution) => {
            created.push(resolution.headers);
            return new InMemorySpanExporter();
          },
        },
      });
      await installed.applySettings({});
      await installed.applySettings({ OTEL_TRACES_EXPORTER: "none" });
      await installed.telemetry.shutdown();
    });
    const decisions = records.filter((record) => record.event === "app.telemetry");
    expect(decisions.map(({ exporting, reason, endpoint }) => ({ exporting, reason, endpoint }))).toEqual([
      { exporting: true, reason: undefined, endpoint: "http://localhost:4318/v1/traces" },
      { exporting: false, reason: "exporter_none", endpoint: undefined },
    ]);
    expect(created).toEqual([{ authorization: "Bearer secret" }]);
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  it("records a traced turn from GUI action to tool as span.end lines", async () => {
    const records = await logRecords(async () => {
      const installed = installMainTelemetry({ env: {}, settings: {}, pipeline: { register: true } });
      const tracing = installed.sessionTracing;
      tracing.starting({ session_id: "s1", agent_id: "claude-acp", workspace_mode: "project", resume: { acp_session_id: "a" } });
      tracing.observe({ type: "session.ready", session_id: "s1", acp_session_id: "a", agent_id: "claude-acp", cwd: "/x" } as never);
      tracing.prompting({ session_id: "s1", turn_id: "t1", text: "hi", traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" });
      tracing.prompting({ session_id: "s1", turn_id: "t2", text: "untraced" });
      tracing.observe({ type: "session.prompt_accepted", session_id: "s1", turn_id: "t1", client_id: "t1", text: "hi" });
      tracing.observe({ type: "session.event", session_id: "s1", turn_id: "t1", event: { update: { sessionUpdate: "tool_call", toolCallId: "c1", kind: "read", title: "Read /secret/path", status: "completed" } } } as never);
      tracing.observe({ type: "session.complete", session_id: "s1", turn_id: "t1" });
      expect(installed.ingestRendererSpans([rendererSpan({ statusCode: 0 })])).toBe(1);
      await installed.telemetry.shutdown();
    });
    const spans = records.filter((record) => record.event === "span.end");
    expect(spans.map((record) => [record.name, record.component])).toEqual([
      ["create_agent", "main"],
      ["execute_tool", "main"],
      ["invoke_agent", "main"],
      ["ui.prompt.send", "renderer"],
    ]);
    const turn = spans.find((record) => record.name === "invoke_agent")!;
    expect(turn).toMatchObject({ trace_id: "0af7651916cd43dd8448eb211c80319c", parent_span_id: "b7ad6b7169203331", status: "ok", level: "info" });
    expect(spans[0]?.attributes).toMatchObject({ "backchat.workspace_mode": "project", "backchat.acp.resumed": true, "backchat.acp.forked": false });
    expect(JSON.stringify(spans)).not.toContain("/secret/path");
  });

  it("describes a resolution with no headers", () => {
    expect(describeResolution(ENABLED)).toEqual({ exporting: true, endpoint: ENABLED.endpoint, protocol: "http/json" });
    expect(describeResolution({ enabled: false, reason: "sdk_disabled", sources: {} })).toEqual({ exporting: false, reason: "sdk_disabled" });
  });
});

describe("renderer settings view", () => {
  it("never carries the telemetry table", () => {
    const view = rendererSettings({
      default: { workspace_path: "", permission_mode: "ask", prompt_queue_enabled: true },
      appearance: { light_theme_id: "a", dark_theme_id: "b", theme: "system", language: "system", font_size: "md", density: "default" },
      agents: [],
      mcp_servers: [],
      telemetry: { OTEL_EXPORTER_OTLP_HEADERS: "authorization=secret" },
    });
    expect(view).not.toHaveProperty("telemetry");
  });
});

