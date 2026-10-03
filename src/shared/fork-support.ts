import type { AcpForkSupport, AcpForkSupportReason } from "@openma/common/acp-runtime";

const LEVELS = new Set(["none", "session", "message"]);
const REASONS = new Set<AcpForkSupportReason>([
  "not-initialized",
  "session-fork-not-advertised",
  "message-fork-not-advertised",
  "message-fork-capability-invalid",
  "message-fork-advertised",
  "message-fork-verified-adapter",
]);

/** Accept the `fork_support` object the main process already computed.
 *  This does not decide whether an agent can fork. */
export function forkSupportFromWire(value: unknown): AcpForkSupport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const level = record.level;
  const reason = record.reason;
  const message = record.message;
  if (typeof level !== "string" || !LEVELS.has(level)) return undefined;
  if (typeof reason !== "string" || !REASONS.has(reason as AcpForkSupportReason)) return undefined;
  if (typeof message !== "string" || !message.trim()) return undefined;
  const rawFork = record.messageFork;
  const fork = rawFork && typeof rawFork === "object" && !Array.isArray(rawFork)
    ? rawFork as Record<string, unknown>
    : undefined;
  const source: "capability" | "verified-adapter" | undefined =
    fork?.source === "capability" ? "capability"
    : fork?.source === "verified-adapter" ? "verified-adapter"
    : undefined;
  const messageFork = fork
    && fork.version === 1
    && fork.inclusive === true
    && source
    ? {
        version: 1 as const,
        inclusive: true as const,
        source,
      }
    : undefined;
  return {
    level: level as AcpForkSupport["level"],
    reason: reason as AcpForkSupportReason,
    message,
    ...(messageFork ? { messageFork } : {}),
  };
}
