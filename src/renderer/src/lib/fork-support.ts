import type { AcpForkSupport } from "@openma/common/acp-runtime";

/** Whole-session fork (`session/fork` with no message point). */
export function wholeSessionForkEnabled(
  support: AcpForkSupport | undefined,
): boolean {
  return !!support && support.level !== "none";
}

/** Inclusive fork from a specific assistant message. */
export function messageForkEnabled(
  support: AcpForkSupport | undefined,
): boolean {
  return support?.level === "message";
}
