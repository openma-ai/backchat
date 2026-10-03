/** Stable CLI exit codes. The `backchat` client and this module must agree. */
export const ExitCode = {
  ok: 0,
  error: 1,
  appNotRunning: 2,
  notFound: 3,
  timeout: 4,
  invalidArgs: 5,
} as const;

export type ControlErrorCode =
  | "error"
  | "app_not_running"
  | "not_found"
  | "timeout"
  | "invalid_args";

export function exitCodeFor(code: ControlErrorCode): number {
  switch (code) {
    case "app_not_running":
      return ExitCode.appNotRunning;
    case "not_found":
      return ExitCode.notFound;
    case "timeout":
      return ExitCode.timeout;
    case "invalid_args":
      return ExitCode.invalidArgs;
    default:
      return ExitCode.error;
  }
}

export interface ControlCall {
  method: string;
  params?: unknown;
  client?: string;
}

export interface ControlSuccess {
  ok: true;
  result: unknown;
}

export interface ControlFailure {
  ok: false;
  error: { code: ControlErrorCode; message: string };
  result?: unknown;
}

/** One NDJSON line from `session send --stream`. */
export type ControlStreamEvent = {
  type: "message_delta" | "tool_call" | "permission" | "result";
  session_id: string;
  timestamp: string;
  turn_id?: string;
  text?: string;
  tool_call_id?: string;
  title?: string;
  kind?: string;
  status?: string;
  /** Success is `ok`. Wire status `completed` is `finished` when no result or permission says otherwise. */
  outcome?: "ok" | "denied" | "failed" | "cancelled" | "finished";
  request_id?: string;
  options?: Array<{ optionId: string; name: string; kind: string }>;
  message?: string;
};

/** One row of `session transcript --json`. `cursor` is the stable event seq. */
export interface TranscriptEvent {
  cursor: string;
  role: "user" | "assistant" | "system" | "tool";
  type: "text" | "tool_call" | "tool_result" | "permission" | "status" | "thought";
  timestamp: string;
  text?: string;
  tool_call_id?: string;
  name?: string;
  status?: string;
  request_id?: string;
}
