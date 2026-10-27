import { SpanKind, SpanStatusCode, context, trace, type Span } from "@opentelemetry/api";
import { traceparentOf } from "@openma/common/telemetry";

/**
 * Typed GUI action tracing on the OpenTelemetry API. Product code records
 * user actions here and never touches the SDK; `lib/telemetry.ts` installs
 * it. Without it every call is a no-op and no traceparent is produced.
 *
 * Actions and their attributes are a closed table: ids, counts and flags
 * only — never prompt text, file names or other content.
 */

export const UI_TRACER_NAME = "backchat.renderer";

export interface UiActionAttributes {
  /** A prompt handed to the main process for an agent turn. */
  "prompt.send": {
    "backchat.prompt.chars": number;
    /** Resent after an earlier attempt failed before the host accepted it. */
    "backchat.prompt.retry": boolean;
  };
  /** A stop press on the composer or the topbar. */
  "turn.cancel": {
    /** The session the stop press belonged to; empty when there was none. */
    "backchat.cancel.session_id": string;
    /** The turn the cancel was addressed to; empty when none could be found. */
    "backchat.cancel.turn_id": string;
    /** Whether a turn could be resolved for the cancel. */
    "backchat.cancel.result": "targeted" | "no_target";
  };
}

export type UiAction = keyof UiActionAttributes;

export interface ActionTrace {
  /** W3C traceparent of the action span; undefined when tracing is off. */
  readonly traceparent: string | undefined;
}

function fail(span: Span, error: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR });
  // The type only; messages may echo user content.
  span.setAttribute("exception.type", error instanceof Error ? error.name : typeof error);
}

/**
 * Run `run` inside a span for `action`. The span ends when `run` returns or
 * its promise settles; a throw or rejection marks it failed and propagates
 * unchanged.
 */
export function withActionTrace<A extends UiAction, T>(
  action: A,
  attributes: UiActionAttributes[A],
  run: (trace: ActionTrace) => T,
): T {
  const span = trace.getTracer(UI_TRACER_NAME).startSpan(`ui.${action}`, {
    kind: SpanKind.INTERNAL,
    attributes: { "backchat.ui.action": action, ...attributes },
  });
  const handle: ActionTrace = { traceparent: traceparentOf(span) };
  let result: T;
  try {
    result = context.with(trace.setSpan(context.active(), span), () => run(handle));
  } catch (error) {
    fail(span, error);
    span.end();
    throw error;
  }
  if (result instanceof Promise) {
    result.then(
      () => span.end(),
      (error: unknown) => {
        fail(span, error);
        span.end();
      },
    );
  } else {
    span.end();
  }
  return result;
}
