/**
 * Protocol-level error classification for ACP.
 *
 * ACP rides on JSON-RPC 2.0, so failed RPCs come back as objects with
 * a numeric `code` plus a free-text `message`. The codes are
 * implementation-defined per JSON-RPC (range -32000…-32099) but the
 * SDK pins them via the `RequestError.{authRequired, resourceNotFound,
 * …}` factory methods. We mirror those here as named constants so the
 * dispatch site reads as protocol semantics, not "match the english
 * message".
 *
 * Why a dedicated module: keep callers from reaching back into the
 * SDK's RequestError class (which is an implementation detail that
 * could be re-exported under a different shape in a future minor
 * release). The numeric codes are the long-lived contract.
 *
 * Source of truth: @agentclientprotocol/sdk's `RequestError.authRequired()`
 * at acp.js line ~1320 emits `code: -32000, message: "Authentication
 * required"`. Same code constant lives in this file.
 */

/** Numeric JSON-RPC error code emitted by an ACP agent when the
 *  requested operation requires the client to authenticate first.
 *  Matches `RequestError.authRequired()` in the ACP SDK. */
export const ACP_AUTH_REQUIRED_CODE = -32000;

/** Shape of a thrown JSON-RPC error after it bubbles out of an
 *  AcpSession RPC. The SDK's RequestError extends Error with these
 *  extra fields; we duck-type to avoid an `instanceof` dependency on
 *  the SDK's internal class. */
interface RpcErrorLike {
  code?: number;
  message?: string;
  data?: unknown;
}

/** True iff the thrown error is the ACP-defined "authentication
 *  required" signal. The dispatch is on numeric code only — no string
 *  matching on the message. */
export function isAuthRequired(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as RpcErrorLike).code === ACP_AUTH_REQUIRED_CODE;
}
