const AUTH_FAILURE_RE =
  /authentication required\b|authentication fails\b|invalid api key|api key[:\s=][^\n]*\binvalid\b/i;

/** Providers that are not the reference ACP client report "there are no usable
 * credentials" in their own wording (`auth_unavailable: no auth available
 * (...)`). The turn cannot continue without credentials, so this is the same
 * class of failure as ACP's "authentication required". */
const AUTH_UNAVAILABLE_RE =
  /\bauth[_\s-]?unavailable\b|\bno auth(?:entication)? available\b|\bauthentication (?:is )?unavailable\b|\bnot authenticated\b|\bunauthorized\b|\bmissing (?:auth(?:entication)?|credentials|api[_\s-]?key)\b/i;

/** The provider refused the request because the plan, quota, or balance is
 * spent. Recovering needs a different plan/account, not another retry. */
const QUOTA_UNAVAILABLE_RE =
  /\binsufficient[_\s-]?quota\b|\bquota (?:exceeded|exhausted|exhaustion|unavailable|ran out)\b|\bexceeded (?:your|the|this) quota\b|\bno quota (?:left|remaining|available)\b|\busage[_\s-]?limit[_\s-]?exceeded\b|\busage limit (?:exceeded|reached)\b|\breached your (?:weekly |daily |monthly )?usage limit\b|\bsession[_\s-]?budget[_\s-]?exceeded\b|\bbudget[_\s-]?exhausted\b|\bcredits? exhausted\b|\bout of credits\b|\bno credits? (?:left|remaining)\b|\bcredit balance is too low\b|\bbilling (?:issue|error|required|expired|not (?:set|configured|active))\b|\bpayment required\b|\bsubscription (?:expired|inactive)\b/i;

/** The provider gave up reconnecting. Another attempt would fail the same way. */
const RETRY_EXHAUSTED_RE =
  /\btoo many failed attempts\b|\bresponseTooManyFailedAttempts\b|\bmaximum retries\b|\bmax retries\b|\bretries? exhausted\b|\breconnect(?:ion|ing)? attempts? exhausted\b|\bgave up (?:after|retrying|reconnecting)\b/i;

/** "Reconnecting... 5/5" — the last attempt already ran. */
const LAST_ATTEMPT_RE = /\b(\d{1,2})\s*\/\s*\1\b/;

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
  return typeof message === "string"
    && (AUTH_FAILURE_RE.test(message) || AUTH_UNAVAILABLE_RE.test(message));
}

export function sanitizeAuthenticationMessage(message: string): string {
  return message
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[redacted]")
    .replace(/\b(api[\s_-]*key|token|secret)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 4_000);
}

/** What a provider error proves about the turn it interrupted. */
export interface CodexProviderErrorEvidence {
  /** The error cannot recover on its own — the turn must fail. */
  terminal: boolean;
  /** Credentials are missing or rejected; the user must sign in again. */
  authUnavailable: boolean;
  /** The provider refused because quota/billing is exhausted. */
  quotaUnavailable: boolean;
  /** The provider stopped reconnecting. */
  retriesExhausted: boolean;
  /** Best user-facing explanation of the failure. */
  message?: string;
  /** Notice for a reconnect that is still retrying. */
  notice?: string;
}

function collectEvidenceText(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 6) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEvidenceText(item, depth + 1, out);
    return out;
  }
  const fields = record(value);
  if (!fields) return out;
  for (const [key, item] of Object.entries(fields)) {
    // Keys carry evidence too: `responseTooManyFailedAttempts` and
    // `usageLimitExceeded` are the provider's own error names.
    out.push(key);
    collectEvidenceText(item, depth + 1, out);
  }
  return out;
}

/** HTTP status codes the provider attached to its structured error info. */
function codexHttpStatusCodes(fields: Record<string, unknown>): number[] {
  const info = record(fields.codexErrorInfo);
  if (!info) return [];
  return Object.values(info)
    .map((variant) => record(variant)?.httpStatusCode)
    .filter((code): code is number => typeof code === "number");
}

function shorten(text: string, max = 300): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Inspect a Codex provider error record (`_meta.codex.error`) and decide
 * whether the turn can keep retrying.
 *
 * `willRetry: true` only means the provider *intends* to retry. A reconnect
 * storm around missing credentials or an exhausted quota never recovers, so
 * the turn has to fail instead of reconnecting forever. The evidence lives in
 * `message`, `additionalDetails`, and the nested `codexErrorInfo` record —
 * including its stringified forms.
 */
export function inspectCodexProviderError(error: unknown): CodexProviderErrorEvidence {
  const fields = record(error);
  if (!fields) {
    return {
      terminal: false,
      authUnavailable: false,
      quotaUnavailable: false,
      retriesExhausted: false,
    };
  }
  const texts = collectEvidenceText(fields);
  const statusCodes = codexHttpStatusCodes(fields);
  const message = typeof fields.message === "string" ? fields.message : undefined;
  const additionalDetails = typeof fields.additionalDetails === "string"
    ? fields.additionalDetails
    : undefined;
  const authUnavailable =
    texts.some((text) => AUTH_UNAVAILABLE_RE.test(text)) || statusCodes.includes(401);
  const quotaUnavailable =
    texts.some((text) => QUOTA_UNAVAILABLE_RE.test(text)) || statusCodes.includes(402);
  const retriesExhausted = texts.some((text) => (
    RETRY_EXHAUSTED_RE.test(text) || LAST_ATTEMPT_RE.test(text)
  ));
  const willRetry = fields.willRetry === true;
  const terminal = !willRetry || authUnavailable || quotaUnavailable || retriesExhausted;
  // The bare "Reconnecting... 2/5" says nothing; the provider's own detail
  // explains what actually went wrong.
  const explanation = authUnavailable || quotaUnavailable
    ? additionalDetails ?? message
    : message ?? additionalDetails;
  const notice = additionalDetails ?? message;
  const explanationText = explanation ? shorten(sanitizeAuthenticationMessage(explanation)) : "";
  const noticeText = notice ? shorten(sanitizeAuthenticationMessage(notice)) : "";
  return {
    terminal,
    authUnavailable,
    quotaUnavailable,
    retriesExhausted,
    ...(explanationText ? { message: explanationText } : {}),
    ...(noticeText ? { notice: noticeText } : {}),
  };
}
