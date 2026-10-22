import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installRendererTelemetry,
  IpcSpanExporter,
  LONG_FRAME_THRESHOLD_MS,
  traceLongFrames,
  traceUncaughtErrors,
} from "./telemetry";
import { withActionTrace } from "./ui-trace";

function setup() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  return { tracer: provider.getTracer("backchat.renderer"), provider, spans: () => exporter.getFinishedSpans() };
}

afterEach(() => {
  trace.disable();
  context.disable();
  vi.unstubAllGlobals();
});

describe("renderer span transport", () => {
  it("reports IPC success and failure to the batch processor", async () => {
    const results: number[] = [];
    await new Promise<void>((resolve) => {
      new IpcSpanExporter(async () => 1).export([], (result) => {
        results.push(result.code);
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      new IpcSpanExporter(async () => {
        throw new Error("closed");
      }).export([], (result) => {
        results.push(result.code);
        expect(result.error?.message).toBe("closed");
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      new IpcSpanExporter(() => Promise.reject("plain")).export([], (result) => {
        results.push(result.code);
        expect(result.error).toBeUndefined();
        resolve();
      });
    });
    expect(results).toEqual([ExportResultCode.SUCCESS, ExportResultCode.FAILED, ExportResultCode.FAILED]);
    await expect(new IpcSpanExporter(async () => 0).shutdown()).resolves.toBeUndefined();
  });
});

describe("uncaught error spans", () => {
  it("records the error type and route only, never the message", () => {
    const { tracer, spans } = setup();
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    let route: string | undefined = "/chat/$sessionId";
    const stop = traceUncaughtErrors(target as never, tracer, () => route);
    listeners.get("error")?.({ error: new TypeError("secret prompt text") });
    route = undefined;
    listeners.get("unhandledrejection")?.({ reason: "plain string" });
    stop();
    expect(listeners.size).toBe(0);
    expect(spans().map((span) => span.attributes)).toEqual([
      { "backchat.ui.error.source": "error", "exception.type": "TypeError", "backchat.ui.route": "/chat/$sessionId" },
      { "backchat.ui.error.source": "unhandledrejection", "exception.type": "string" },
    ]);
    expect(spans().every((span) => span.status.code === SpanStatusCode.ERROR)).toBe(true);
    expect(JSON.stringify(spans().map((span) => span.status))).not.toContain("secret");
  });
});

describe("long animation frame spans", () => {
  function fakeObserver(supported: string[]) {
    let callback: ((list: { getEntries(): unknown[] }) => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const Observer = Object.assign(
      function (this: unknown, cb: typeof callback) {
        callback = cb;
        return { observe, disconnect };
      },
      { supportedEntryTypes: supported },
    ) as unknown as typeof PerformanceObserver;
    return { Observer, observe, disconnect, emit: (entries: unknown[]) => callback?.({ getEntries: () => entries }) };
  }

  it("records frames past the threshold with the longest script as attribution", () => {
    const { tracer, spans } = setup();
    const fake = fakeObserver(["long-animation-frame"]);
    let route: string | undefined = "/chat/$sessionId";
    const stop = traceLongFrames(tracer, () => route, fake.Observer);
    expect(fake.observe).toHaveBeenCalledWith({ type: "long-animation-frame", buffered: true });
    fake.emit([
      { startTime: 10, duration: LONG_FRAME_THRESHOLD_MS - 1 },
      {
        startTime: 1000,
        duration: 240.4,
        blockingDuration: 190.6,
        scripts: [
          { duration: 20, invokerType: "event-listener", invoker: "BUTTON.onclick" },
          { duration: 200, invokerType: "user-callback", invoker: "FrameRequestCallback", sourceFunctionName: "pinDuringSettle" },
        ],
      },
    ]);
    route = undefined;
    fake.emit([{ startTime: 2000, duration: 120 }]);
    stop();
    expect(fake.disconnect).toHaveBeenCalled();
    expect(spans().map((span) => [span.name, span.attributes])).toEqual([
      ["ui.long_frame", {
        "backchat.ui.frame.duration_ms": 240,
        "backchat.ui.frame.blocking_ms": 191,
        "backchat.ui.frame.scripts": 2,
        "backchat.ui.frame.invoker_type": "user-callback",
        "backchat.ui.frame.invoker": "FrameRequestCallback",
        "code.function.name": "pinDuringSettle",
        "backchat.ui.route": "/chat/$sessionId",
      }],
      ["ui.long_frame", { "backchat.ui.frame.duration_ms": 120, "backchat.ui.frame.scripts": 0 }],
    ]);
  });

  it("does nothing where long animation frames are unsupported", () => {
    const { tracer, spans } = setup();
    const fake = fakeObserver(["longtask"]);
    traceLongFrames(tracer, () => undefined, fake.Observer)();
    traceLongFrames(tracer, () => undefined, undefined)();
    expect(fake.observe).not.toHaveBeenCalled();
    expect(spans()).toHaveLength(0);
  });
});

describe("GUI action tracing", () => {
  it("hands out a traceparent and ends with the action", async () => {
    const { provider, spans } = setup();
    trace.setGlobalTracerProvider(provider);
    const attributes = { "backchat.prompt.chars": 5, "backchat.prompt.retry": false };
    let traceparent: string | undefined;
    await withActionTrace("prompt.send", attributes, async (handle) => {
      traceparent = handle.traceparent;
    });
    const [span] = spans();
    expect(traceparent).toBe(`00-${span?.spanContext().traceId}-${span?.spanContext().spanId}-01`);
    expect(span?.attributes).toEqual({ "backchat.ui.action": "prompt.send", ...attributes });
    expect(withActionTrace("prompt.send", attributes, () => 7)).toBe(7);
    expect(spans()).toHaveLength(2);
  });

  it("marks a failed action with the error type only and rethrows", async () => {
    const { provider, spans } = setup();
    trace.setGlobalTracerProvider(provider);
    const attributes = { "backchat.prompt.chars": 1, "backchat.prompt.retry": true };
    await expect(withActionTrace("prompt.send", attributes, async () => {
      throw new RangeError("secret");
    })).rejects.toThrow("secret");
    expect(() => withActionTrace("prompt.send", attributes, () => {
      throw "thrown";
    })).toThrow();
    await Promise.resolve();
    expect(spans().map((span) => [span.status.code, span.attributes["exception.type"]])).toEqual([
      [SpanStatusCode.ERROR, "RangeError"],
      [SpanStatusCode.ERROR, "string"],
    ]);
  });

  it("is a no-op without an installed provider", () => {
    let traceparent: string | undefined = "unset";
    withActionTrace("prompt.send", { "backchat.prompt.chars": 0, "backchat.prompt.retry": false }, (handle) => {
      traceparent = handle.traceparent;
    });
    expect(traceparent).toBeUndefined();
  });
});

describe("renderer telemetry install", () => {
  it("is not installed without the IPC bridge", () => {
    expect(installRendererTelemetry({ send: undefined, route: () => undefined })).toBeUndefined();
  });

  it("ships ui.startup and errors over IPC and flushes on shutdown", async () => {
    const listeners = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    const sent: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    const installed = installRendererTelemetry({
      send: async (spans) => {
        sent.push(...spans);
        return spans.length;
      },
      route: () => "/",
      serviceVersion: "1.0.0",
    })!;
    installed.markRouteReady();
    installed.markRouteReady();
    listeners.get("error")?.({ error: new Error("x") });
    listeners.get("pagehide")?.({});
    await installed.shutdown();
    expect(listeners.size).toBe(0);
    expect(sent.map((span) => [span.name, span.attributes["backchat.ui.route"]])).toEqual([
      ["ui.startup", "/"],
      ["ui.error", "/"],
    ]);
  });
});
