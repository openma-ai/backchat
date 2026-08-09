import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  groupActivityTools,
  projectActivityTools,
  type ActivityTool,
} from "@/lib/activity-tool-groups";
import {
  activityPresentationPolicy,
  type ActivityPresentationPolicy,
} from "@/lib/activity-presentation-policy";
import type { TurnRender } from "@/lib/reduce-turn";
import type { SubagentActivity, Turn } from "@/lib/session-store";
import { cn } from "@/lib/utils";
import { ActivityToolGroup } from "./ActivityToolGroup";
import {
  ASSISTANT_MARKDOWN_CLASS,
  StreamdownText,
} from "./ChatMarkdown";
import { latestThoughtSegment } from "@openma/common/session-events/acp";
import { StreamingMarkdown } from "./StreamingMarkdown";

export function TurnActivity({
  turn,
  rendered,
  subagents,
  agentId,
  isStreaming,
  cwd,
  completeLabel,
}: {
  turn: Turn;
  rendered: TurnRender;
  subagents: SubagentActivity[];
  agentId?: string;
  isStreaming: boolean;
  cwd: string | null;
  completeLabel: string;
}) {
  const policy = activityPresentationPolicy(agentId);
  const commentaryItems = rendered.timeline.filter(
    (item) => item.kind === "assistant_text" && item.phase === "commentary",
  );
  const hasThought =
    turn.thoughtText.trim().length > 0 &&
    (policy.persistThoughtTimeline ||
      (isStreaming && Boolean(rendered.currentThoughtText)));
  const { activeTool, visibleToolIds } = projectActivityTools(
    rendered,
    isStreaming,
  );
  const toolGroups = groupActivityTools({
    rendered,
    visibleToolIds,
    activeTool,
    groupAcrossThoughts: policy.groupToolsAcrossThoughts,
  });
  const hasActivity =
    hasThought ||
    commentaryItems.length > 0 ||
    visibleToolIds.size > 0 ||
    Boolean(activeTool);
  if (!hasActivity) return null;

  let assistantPrefix = 0;
  return (
    <Reasoning isStreaming={isStreaming} defaultOpen={true}>
      {!isStreaming && (
        <ReasoningTrigger
          showIcon={false}
          getThinkingMessage={() => (
            <span className="text-fg-muted">{completeLabel}</span>
          )}
        />
      )}
      <ReasoningContent className={cn("space-y-1", isStreaming && "pt-0")}>
        {rendered.timeline.map((item, index) => {
          if (item.kind === "assistant_text") {
            const prefix = assistantPrefix;
            assistantPrefix += item.text.length;
            if (item.phase !== "commentary") return null;
            const isLiveTail =
              isStreaming && index === rendered.timeline.length - 1;
            return (
              <div key={`activity-text-${index}`} className="min-w-0">
                {isLiveTail ? (
                  <StreamingMarkdown
                    turnId={turn.id}
                    kind="assistant"
                    cwd={cwd}
                    prefixSkip={prefix}
                  />
                ) : (
                  <StreamdownText
                    className={ASSISTANT_MARKDOWN_CLASS}
                    text={item.text}
                    cwd={cwd}
                    sessionId={turn.sessionId}
                    surfacePrefix={`${turn.id}-activity-${index}`}
                  />
                )}
              </div>
            );
          }
          if (item.kind === "thought") {
            if (!policy.persistThoughtTimeline) return null;
            const isLiveTail =
              isStreaming && index === rendered.timeline.length - 1;
            if (isLiveTail) {
              return (
                <StreamingMarkdown
                  key={`activity-thought-live-${item.messageId ?? index}`}
                  turnId={turn.id}
                  kind="thought"
                  cwd={cwd}
                  className="text-fg-muted"
                  paceReplay
                />
              );
            }
            return (
              <StreamdownText
                key={`activity-thought-${item.messageId ?? index}`}
                className="text-[13px] leading-6 text-fg-muted"
                text={item.text}
                cwd={cwd}
                sessionId={turn.sessionId}
                surfacePrefix={`${turn.id}-thought-${index}`}
              />
            );
          }
          const group = toolGroups.byStartIndex.get(index);
          if (!group) return null;
          return (
            <ActivityToolGroup
              key={`activity-tools-${group.map((tool) => tool.toolCallId).join("-")}`}
              tools={group}
              sessionId={turn.sessionId}
              subagents={subagents}
            />
          );
        })}

        {toolGroups.trailing.length > 0 && (
          <ActivityToolGroup
            key={`activity-tools-trailing-${toolGroups.trailing.map((tool) => tool.toolCallId).join("-")}`}
            tools={toolGroups.trailing}
            sessionId={turn.sessionId}
            subagents={subagents}
          />
        )}

        {/* Not either/or with the trailing tools. A tool running is not a reason
            to stop saying what the agent is thinking; the turn has not ended. */}
        <LatestThoughtStatus
          rendered={rendered}
          policy={policy}
          isStreaming={isStreaming}
        />
      </ReasoningContent>
    </Reasoning>
  );
}

function LatestThoughtStatus({
  rendered,
  policy,
  isStreaming,
}: {
  rendered: TurnRender;
  policy: ActivityPresentationPolicy;
  isStreaming: boolean;
}) {
  // A running tool used to suppress this line, which left the reasoning block
  // empty for the whole tool call: Codex keeps no thought items in the timeline,
  // and the trigger only renders once streaming stops. The turn has not ended,
  // so the thinking it is doing is exactly what to show.
  // `currentThoughtText` empties as soon as a tool call arrives, because that
  // thought is no longer the thing streaming. While the turn is still running
  // the last thought is still what the agent is working from, so fall back to
  // it — otherwise Codex, which keeps no thought items in the timeline, leaves
  // the reasoning block empty for the whole tool call.
  const lastThoughtItem = rendered.timeline.findLast(
    (item) => item.kind === "thought",
  );
  const latest = rendered.currentThoughtText
    || latestThoughtSegment(
      lastThoughtItem?.kind === "thought" ? lastThoughtItem.text : "",
    );
  if (!isStreaming || !policy.showLatestThoughtStatus || !latest) {
    return null;
  }

  return (
    <div
      className="min-w-0 text-fg-muted"
      data-current-activity={latest}
    >
      {/* One clamped line, not a streamed markdown block. `currentThoughtText`
          is `latestThoughtSegment()`'s output — trimmed and rejoined — so it is
          not a suffix of `thoughtText`, and the length arithmetic that used to
          drive a replay skip here could exceed the accumulator and render
          nothing at all, leaving an empty box under the tool row. The status
          line only ever showed one truncated line, so it can just be that
          line. */}
      <p className="truncate text-sm leading-5 text-fg-muted">
        {latest}
      </p>
    </div>
  );
}
