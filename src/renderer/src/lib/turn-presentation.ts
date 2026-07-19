import type { Turn } from "@/lib/session-store";

export function turnWorkDurationSeconds(
  turn: Pick<Turn, "startedAt" | "endedAt" | "events">,
): number {
  const eventEnd = turn.events.at(-1)?.receivedAt;
  const end = turn.endedAt ?? eventEnd ?? turn.startedAt;
  return Math.max(0, Math.ceil((end - turn.startedAt) / 1000));
}

export function shouldShowTransientThought({
  isStreaming,
  thoughtText,
  hasVisibleContent,
}: {
  isStreaming: boolean;
  thoughtText: string;
  hasVisibleContent: boolean;
}): boolean {
  return isStreaming && thoughtText.trim().length > 0 && !hasVisibleContent;
}
