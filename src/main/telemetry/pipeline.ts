import type { Context } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type ReadableSpan,
  type Span,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { TelemetryExportResolution } from "@openma/common/telemetry";

import { createOtlpTraceExporter } from "./exporters.js";

/**
 * The main process's OpenTelemetry pipeline — the only main-process module
 * (with exporters.ts) that depends on the SDK. Instrumented code uses
 * `@opentelemetry/api` alone.
 *
 * Two processors:
 * - `SpanLogProcessor`, always on: every finished span becomes one local
 *   log line, so a trace is readable with no collector;
 * - a switchable `BatchSpanProcessor` + OTLP exporter, present only while
 *   export is enabled.
 * Renderer spans arrive over IPC and go through the same processors.
 */

export type EnabledResolution = Extract<TelemetryExportResolution, { enabled: true }>;

export interface MainTelemetry {
  /** Start, retarget or stop OTLP export. Calls are serialised. */
  applyExport(resolution: TelemetryExportResolution): Promise<void>;
  /** Finished spans recorded elsewhere (the renderer). */
  ingest(spans: readonly ReadableSpan[]): void;
  readonly exporting: boolean;
  shutdown(): Promise<void>;
}

/** Writes every finished span to the local log. Never throws. */
export class SpanLogProcessor implements SpanProcessor {
  constructor(private readonly emit: (span: ReadableSpan) => void) {}
  onStart(_span: Span, _parentContext: Context): void {}
  onEnd(span: ReadableSpan): void {
    try {
      this.emit(span);
    } catch {
      // Local summaries must never break the traced code path.
    }
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** A processor slot whose occupant can be swapped while running. */
export class SwitchableSpanProcessor implements SpanProcessor {
  #delegate: SpanProcessor | undefined;

  get active(): boolean {
    return this.#delegate !== undefined;
  }

  /** Install `next`; the previous processor is flushed and shut down. */
  async replace(next: SpanProcessor | undefined): Promise<void> {
    const previous = this.#delegate;
    this.#delegate = next;
    await previous?.shutdown().catch(() => undefined);
  }

  onStart(span: Span, parentContext: Context): void {
    this.#delegate?.onStart(span, parentContext);
  }
  onEnd(span: ReadableSpan): void {
    this.#delegate?.onEnd(span);
  }
  forceFlush(): Promise<void> {
    return this.#delegate?.forceFlush() ?? Promise.resolve();
  }
  shutdown(): Promise<void> {
    return this.replace(undefined);
  }
}

export interface MainTelemetryOptions {
  emitSpan: (span: ReadableSpan) => void;
  serviceVersion?: string;
  createExporter?: (resolution: EnabledResolution) => SpanExporter;
  /** Register as the process-global provider (default true). */
  register?: boolean;
}

export const MAIN_SERVICE_NAME = "backchat-main";

export function createMainTelemetry(
  options: MainTelemetryOptions,
): MainTelemetry & { readonly provider: NodeTracerProvider } {
  const exportSlot = new SwitchableSpanProcessor();
  const processors: readonly SpanProcessor[] = [new SpanLogProcessor(options.emitSpan), exportSlot];
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": MAIN_SERVICE_NAME,
      ...(options.serviceVersion ? { "service.version": options.serviceVersion } : {}),
    }),
    spanProcessors: [...processors],
  });
  if (options.register !== false) provider.register();
  const createExporter = options.createExporter ?? createOtlpTraceExporter;
  let pending = Promise.resolve();

  return {
    provider,
    get exporting() {
      return exportSlot.active;
    },
    ingest(spans) {
      for (const span of spans) for (const processor of processors) processor.onEnd(span);
    },
    applyExport(resolution) {
      pending = pending.then(() =>
        exportSlot.replace(resolution.enabled ? new BatchSpanProcessor(createExporter(resolution)) : undefined),
      );
      return pending;
    },
    async shutdown() {
      await pending.catch(() => undefined);
      await provider.shutdown();
    },
  };
}
