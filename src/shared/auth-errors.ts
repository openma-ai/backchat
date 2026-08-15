const AUTH_FAILURE_RE =
  /authentication required\b|authentication fails\b|invalid api key|api key[:\s=][^\n]*\binvalid\b/i;

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
