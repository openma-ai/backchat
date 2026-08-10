import type { TurnRender } from "@/lib/reduce-turn";
import { isToolRunning, type ActivityTool } from "@/lib/activity-tool-groups";

/** What the last row of the work block is reporting.
 *
 * The row is always there while a turn runs, so the only question is which of a
 * closed set of things it is saying. Every one of these was previously decided
 * by its own boolean at the call site, and the combinations nobody named are
 * exactly where the duplicated sentences and the stranded fallback came from:
 * "thinking" printed under streaming text, and a thought echoed under the block
 * that was already showing it.
 *
 * The order below is the priority order, and it is total: exactly one state
 * holds for any turn.
 *
 * - `settled`   the turn has ended; the row has nothing to report and collapses
 * - `running`   a tool is running; the command is the report, and it outranks
 *               the rest because a thought streaming beside it left the command
 *               reported by nothing
 * - `answering` the answer is arriving; the text is the report
 * - `reasoning` the thinking block is streaming above; the block is the report
 * - `waiting`   the harness is working and none of the above is visible
 */
export type LiveActivityState =
  | { kind: "settled" }
  | { kind: "answering" }
  | { kind: "reasoning" }
  | { kind: "running"; command: string }
  | { kind: "waiting" };

export interface LiveActivityInput {
  rendered: TurnRender;
  isStreaming: boolean;
  /** Tools that have run since the agent last spoke, newest last. */
  liveTools: readonly ActivityTool[];
  /** What to call the command a tool is running, in the caller's language. */
  describeCommand: (tool: ActivityTool) => string;
}

export function liveActivityState({
  rendered,
  isStreaming,
  liveTools,
  describeCommand,
}: LiveActivityInput): LiveActivityState {
  if (!isStreaming) return { kind: "settled" };

  const runningTool = liveTools.findLast((tool) => isToolRunning(tool.status));
  if (runningTool) {
    const command = describeCommand(runningTool).trim();
    if (command) return { kind: "running", command };
  }

  const last = rendered.timeline.at(-1);
  if (last?.kind === "assistant_text") return { kind: "answering" };
  if (last?.kind === "thought") return { kind: "reasoning" };
  return { kind: "waiting" };
}
