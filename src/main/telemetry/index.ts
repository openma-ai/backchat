import { trace } from "@opentelemetry/api";
import {
  AcpTraceObserver,
  resolveTelemetryExport,
  summarizeSpan,
  type TelemetryExportResolution,
  type TelemetryValues,
} from "@openma/common/telemetry";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";

import { logAppEvent } from "../app-log.js";
import type { SessionEventOut, SessionPromptParams, SessionStartParams } from "../../shared/session-events.js";
import { RENDERER_SERVICE_NAME } from "../../shared/telemetry.js";
import { createMainTelemetry, type MainTelemetry, type MainTelemetryOptions } from "./pipeline.js";
import { createRendererSpanDecoder } from "./renderer-spans.js";

/** Master switch, after Claude Code's `CLAUDE_CODE_ENABLE_TELEMETRY`. */
export const TELEMETRY_ENABLE_KEY = "BACKCHAT_ENABLE_TELEMETRY";

export const ACP_TRACER_NAME = "backchat.acp";

/** Tracing hooks around the session manager's commands and output. */
export interface SessionTracing {
  starting(params: SessionStartParams): void;
  prompting(params: SessionPromptParams): void;
  observe(message: SessionEventOut): void;
}

export function createSessionTracing(
  observer = new AcpTraceObserver(trace.getTracer(ACP_TRACER_NAME)),
): SessionTracing {
  return {
    starting(params) {
      observer.sessionStarting({
        sessionId: params.session_id,
        agentName: params.agent_id,
        attributes: {
          ...(params.workspace_mode ? { "backchat.workspace_mode": params.workspace_mode } : {}),
          "backchat.acp.resumed": !!params.resume?.acp_session_id,
          "backchat.acp.forked": !!params.fork,
        },
      });
    },
    prompting(params) {
      if (params.traceparent) observer.linkTurn(params.session_id, params.turn_id, params.traceparent);
    },
    observe(message) {
      observer.observe(message);
    },
  };
}

/** Write a finished span as one local `span.end` record. */
export function logSpan(span: ReadableSpan): void {
  const summary = summarizeSpan(span);
  const fromRenderer = span.resource.attributes["service.name"] === RENDERER_SERVICE_NAME;
  logAppEvent("span.end", { ...summary }, {
    level: summary.status === "error" ? "warn" : "info",
    component: fromRenderer ? "renderer" : "main",
  });
}

/** The export decision as logged: never endpoint headers. */
export function describeResolution(resolution: TelemetryExportResolution): Record<string, unknown> {
  return resolution.enabled
    ? { exporting: true, endpoint: resolution.endpoint, protocol: resolution.protocol }
    : { exporting: false, reason: resolution.reason };
}

export interface InstalledTelemetry {
  telemetry: MainTelemetry;
  sessionTracing: SessionTracing;
  /** Re-resolve export from the current settings table. */
  applySettings(settings: TelemetryValues | undefined): Promise<void>;
  ingestRendererSpans(batch: unknown): number;
}

export function installMainTelemetry(options: {
  serviceVersion?: string;
  env?: TelemetryValues;
  settings?: TelemetryValues;
  pipeline?: Partial<MainTelemetryOptions>;
}): InstalledTelemetry {
  const env = options.env ?? process.env;
  const telemetry = createMainTelemetry({
    emitSpan: logSpan,
    ...(options.serviceVersion ? { serviceVersion: options.serviceVersion } : {}),
    ...options.pipeline,
  });
  const decode = createRendererSpanDecoder(options.serviceVersion);
  let last = "";
  const applySettings = async (settings: TelemetryValues | undefined) => {
    const resolution = resolveTelemetryExport({ enableKey: TELEMETRY_ENABLE_KEY, env, settings: settings ?? {} });
    const described = describeResolution(resolution);
    const key = JSON.stringify([described, resolution.enabled ? resolution.headers : null]);
    if (key === last) return;
    last = key;
    await telemetry.applyExport(resolution);
    logAppEvent("app.telemetry", described);
  };
  void applySettings(options.settings);
  return {
    telemetry,
    sessionTracing: createSessionTracing(),
    applySettings,
    ingestRendererSpans(batch) {
      const spans = decode(batch);
      telemetry.ingest(spans);
      return spans.length;
    },
  };
}
