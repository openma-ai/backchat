import { SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  WebTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-web";

import {
  encodeSpan,
  RENDERER_SERVICE_NAME,
  type RendererSpanWire,
} from "../../../shared/telemetry";
import { UI_TRACER_NAME } from "./ui-trace";

/**
 * Renderer OpenTelemetry SDK setup — the only renderer module that depends
 * on the SDK. Finished spans cross IPC to the main process, which writes
 * local summaries and forwards them only when export is enabled, with its
 * own endpoint and credentials. The renderer never sees either.
 */

/** Exports finished spans to the main process over IPC. */
export class IpcSpanExporter implements SpanExporter {
  constructor(private readonly send: (spans: RendererSpanWire[]) => Promise<unknown>) {}

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    this.send(spans.map(encodeSpan)).then(
      () => done({ code: ExportResultCode.SUCCESS }),
      (error: unknown) => done({
        code: ExportResultCode.FAILED,
        ...(error instanceof Error ? { error } : {}),
      }),
    );
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** Where the GUI is, as a route pattern without ids (e.g. `/chat/$sessionId`). */
export type RouteSource = () => string | undefined;

/** `ui.error` for uncaught errors and unhandled rejections — the type only. */
export function traceUncaughtErrors(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  tracer: Tracer,
  route: RouteSource,
): () => void {
  const record = (source: string, error: unknown) => {
    const span = tracer.startSpan("ui.error", {
      attributes: {
        "backchat.ui.error.source": source,
        // Messages and stacks may echo user content.
        "exception.type": error instanceof Error ? error.name : typeof error,
        ...(route() ? { "backchat.ui.route": route()! } : {}),
      },
    });
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  };
  const onError = (event: ErrorEvent) => record("error", event.error);
  const onRejection = (event: PromiseRejectionEvent) => record("unhandledrejection", event.reason);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Frames below this are common and not worth a span each. */
export const LONG_FRAME_THRESHOLD_MS = 100;

interface LongAnimationFrameScript {
  invokerType?: string;
  invoker?: string;
  sourceFunctionName?: string;
  duration: number;
}

interface LongAnimationFrameEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: LongAnimationFrameScript[];
}

/**
 * `ui.long_frame` for every long animation frame of at least
 * `LONG_FRAME_THRESHOLD_MS` (Long Animation Frames API; Chromium only),
 * with the route and the longest script's invoker as code attribution.
 */
export function traceLongFrames(
  tracer: Tracer,
  route: RouteSource,
  Observer: typeof PerformanceObserver | undefined = globalThis.PerformanceObserver,
): () => void {
  if (!Observer?.supportedEntryTypes?.includes("long-animation-frame")) return () => undefined;
  const observer = new Observer((list) => {
    for (const entry of list.getEntries() as LongAnimationFrameEntry[]) {
      if (entry.duration < LONG_FRAME_THRESHOLD_MS) continue;
      const top = [...(entry.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];
      const span = tracer.startSpan("ui.long_frame", {
        startTime: entry.startTime,
        attributes: {
          "backchat.ui.frame.duration_ms": Math.round(entry.duration),
          ...(entry.blockingDuration !== undefined
            ? { "backchat.ui.frame.blocking_ms": Math.round(entry.blockingDuration) }
            : {}),
          "backchat.ui.frame.scripts": entry.scripts?.length ?? 0,
          ...(top?.invokerType ? { "backchat.ui.frame.invoker_type": top.invokerType } : {}),
          ...(top?.invoker ? { "backchat.ui.frame.invoker": top.invoker.slice(0, 128) } : {}),
          ...(top?.sourceFunctionName ? { "code.function.name": top.sourceFunctionName.slice(0, 128) } : {}),
          ...(route() ? { "backchat.ui.route": route()! } : {}),
        },
      });
      span.end(entry.startTime + entry.duration);
    }
  });
  observer.observe({ type: "long-animation-frame", buffered: true });
  return () => observer.disconnect();
}

export interface RendererTelemetry {
  /** Close `ui.startup` once the first route has rendered. */
  markRouteReady(): void;
  shutdown(): Promise<void>;
}

export function installRendererTelemetry(options: {
  send: ((spans: RendererSpanWire[]) => Promise<unknown>) | undefined;
  route: RouteSource;
  serviceVersion?: string;
}): RendererTelemetry | undefined {
  if (!options.send) return undefined;
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": RENDERER_SERVICE_NAME,
      ...(options.serviceVersion ? { "service.version": options.serviceVersion } : {}),
    }),
    spanProcessors: [new BatchSpanProcessor(new IpcSpanExporter(options.send))],
  });
  provider.register();
  const tracer = trace.getTracer(UI_TRACER_NAME);
  let startup: ReturnType<Tracer["startSpan"]> | undefined = tracer.startSpan("ui.startup", {
    startTime: performance.timeOrigin,
  });
  const stopErrors = traceUncaughtErrors(window, tracer, options.route);
  const stopFrames = traceLongFrames(tracer, options.route);
  const onPageHide = () => void provider.forceFlush();
  window.addEventListener("pagehide", onPageHide);
  return {
    markRouteReady() {
      if (!startup) return;
      const route = options.route();
      if (route) startup.setAttribute("backchat.ui.route", route);
      startup.end();
      startup = undefined;
    },
    async shutdown() {
      stopErrors();
      stopFrames();
      window.removeEventListener("pagehide", onPageHide);
      await provider.shutdown();
    },
  };
}
