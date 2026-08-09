import type { TranslationKey } from "@/lib/i18n";

/** How a finished turn ended, according to the agent.
 *
 * ACP's PromptResponse carries a StopReason, and only `end_turn` means the agent
 * said what it had to say. `max_tokens`, `max_turn_requests` and `refusal` all
 * arrive as an ordinary completion on the wire, so a turn that was cut off or
 * declined looked exactly like a finished one — the user was left to guess from
 * a sentence that stops mid-thought.
 */
export type TurnStopNotice = {
  /** i18n key for the notice text. */
  key: TranslationKey;
  /** Whether the turn was cut short rather than declined. */
  tone: "truncated" | "refused";
};

const NOTICES: Record<string, TurnStopNotice> = {
  max_tokens: { key: "chat.stopMaxTokens", tone: "truncated" },
  max_turn_requests: { key: "chat.stopMaxTurnRequests", tone: "truncated" },
  refusal: { key: "chat.stopRefusal", tone: "refused" },
};

/** The notice a finished turn owes the reader, or null when it ended normally.
 *
 * `end_turn` and a missing reason both mean "nothing to say about it": older
 * transports report a bare completion boundary, and inventing a notice for
 * silence would be worse than staying quiet. `cancelled` is not here either —
 * cancellation already has its own turn status and its own presentation.
 */
export function turnStopNotice(
  turn: { status: string; stopReason?: string },
): TurnStopNotice | null {
  if (turn.status !== "complete") return null;
  if (!turn.stopReason) return null;
  return NOTICES[turn.stopReason] ?? null;
}
