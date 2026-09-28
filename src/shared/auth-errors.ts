const AUTH_FAILURE_RE =
  /authentication required\b|authentication fails\b|invalid api key|api key[:\s=][^\n]*\binvalid\b/i;

export interface SessionErrorDetails {
  message: string;
  code?: number;
  data?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function isAuthenticationRequiredError(error: unknown, agentId?: string): boolean {
  if (typeof error === "string") return isAuthenticationFailureMessage(error);
  const rpc = record(error);
  if (!rpc) return false;
  // ACP AuthenticationRequired applies to both setup and an active session.
  if (rpc.code === -32000) return true;
  // Older codex-acp versions wrap terminal auth failures in InternalError
  // when credentials were configured at process startup. Scope this shim to
  // the adapter and its typed evidence; -32603 alone says nothing about auth.
  if (agentId === "codex-acp" && rpc.code === -32603) {
    const info = record(rpc.data)?.codexErrorInfo;
    if (info === "unauthorized") return true;
    const variants = record(info);
    if (variants && [
      "httpConnectionFailed",
      "responseStreamConnectionFailed",
      "responseStreamDisconnected",
      "responseTooManyFailedAttempts",
    ].some((key) => record(variants[key])?.httpStatusCode === 401)) return true;
  }
  return isAuthenticationFailureMessage(typeof rpc.message === "string" ? rpc.message : undefined);
}

/** Only JSON-safe, redacted RPC evidence crosses IPC and enters event storage. */
export function sessionErrorDetails(error: unknown): SessionErrorDetails | undefined {
  const rpc = record(error);
  if (!rpc || typeof rpc.message !== "string") return undefined;
  return {
    message: sanitizeAuthenticationMessage(rpc.message),
    ...(typeof rpc.code === "number" && Number.isFinite(rpc.code) ? { code: rpc.code } : {}),
    ...(rpc.data !== undefined ? { data: sanitizeErrorData(rpc.data) } : {}),
  };
}

function sanitizeErrorData(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeAuthenticationMessage(value);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (depth >= 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeErrorData(item, depth + 1));
  const fields = record(value);
  if (!fields) return null;
  return Object.fromEntries(Object.entries(fields).slice(0, 100).map(([key, item]) => [
    key,
    /^(?:authorization|(?:access|refresh|id)?[_-]?token|api[_-]?key|secret|password)$/i.test(key)
      ? "[redacted]"
      : sanitizeErrorData(item, depth + 1),
  ]));
}

export function isAuthenticationFailureMessage(message: string | undefined): boolean {
  return typeof message === "string" && AUTH_FAILURE_RE.test(message);
}

export function sanitizeAuthenticationMessage(message: string): string {
  return message
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[redacted]")
    .replace(/\b(api[\s_-]*key|token|secret)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 4_000);
}
