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
import { useRef } from "react";

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
      {/* Always mounted, so settling changes what this row says instead of
          adding a row and pushing the whole block down. While the turn runs it
          is transparent and unclickable: the summary belongs to a finished
          turn, and a word above live activity is what this row is not. */}
      <ReasoningTrigger
        showIcon={false}
        aria-hidden={isStreaming ? true : undefined}
        tabIndex={isStreaming ? -1 : undefined}
        className={cn(
          // A fixed row height, so an empty label while streaming occupies
          // exactly what the finished label will.
          "min-h-5 transition-opacity duration-[var(--dur-slow)] ease-[var(--ease-soft)]",
          isStreaming && "pointer-events-none opacity-0",
        )}
        getThinkingMessage={() => (
          <span className="text-fg-muted">
            {isStreaming ? "" : completeLabel}
          </span>
        )}
      />
      {/* The padding no longer depends on the turn's state: the summary row above
          is always mounted, so dropping it while streaming only made everything
          below shift when the turn settled. */}
      <ReasoningContent className="space-y-1">
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
                    paceReplay
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
  // Removing this row when the turn settled pulled everything below it up by a
  // line in a single frame. The row stays mounted and collapses instead, and it
  // keeps the last line it showed so there is something to animate out.
  const shown = useRef("");
  if (latest) shown.current = latest;
  const show = isStreaming && policy.showLatestThoughtStatus && Boolean(latest);
  if (!shown.current) return null;

  return (
    <div
      className={cn(
        "grid min-w-0 text-fg-muted",
        "transition-[grid-template-rows,opacity] duration-[var(--dur-slow)] ease-[var(--ease-soft)]",
        show ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      data-activity-status-row="true"
      aria-hidden={show ? undefined : true}
      {...(show ? {} : { inert: true })}
      {...(show ? { "data-current-activity": shown.current } : {})}
    >
      <div className="min-h-0 overflow-hidden">
      {/* One clamped line, not a streamed markdown block. `currentThoughtText`
          is `latestThoughtSegment()`'s output — trimmed and rejoined — so it is
          not a suffix of `thoughtText`, and the length arithmetic that used to
          drive a replay skip here could exceed the accumulator and render
          nothing at all, leaving an empty box under the tool row. The status
          line only ever showed one truncated line, so it can just be that
          line. */}
      {/* The transcript's own scale. This line said the same kind of thing as the
          thought text above it but a size larger, which read as a different
          typeface. */}
      <p className="truncate text-[13px] leading-6 text-fg-muted">
        {shown.current}
      </p>
      </div>
    </div>
  );
}
