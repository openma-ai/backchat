import type { TurnRender } from "@/lib/reduce-turn";

type Timeline = TurnRender["timeline"];

/**
 * The process surface must be one chronological prefix of the turn. Text
 * before a later thought/tool belongs to that prefix even when a generic ACP
 * agent cannot label it as commentary.
 */
export function processTimelineEndIndex(timeline: Timeline): number {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind !== "assistant_text" || item.phase === "commentary") {
      return index;
    }
  }
  return -1;
}
