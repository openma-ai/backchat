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
      <ReasoningContent className={cn("space-y-1", isStreaming && "mt-0")}>
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

        {toolGroups.trailing.length > 0 ? (
          <ActivityToolGroup
            key={`activity-tools-trailing-${toolGroups.trailing.map((tool) => tool.toolCallId).join("-")}`}
            tools={toolGroups.trailing}
            sessionId={turn.sessionId}
            subagents={subagents}
          />
        ) : (
          <LatestThoughtStatus
            turn={turn}
            rendered={rendered}
            policy={policy}
            activeTool={activeTool}
            isStreaming={isStreaming}
            cwd={cwd}
          />
        )}
      </ReasoningContent>
    </Reasoning>
  );
}

function LatestThoughtStatus({
  turn,
  rendered,
  policy,
  activeTool,
  isStreaming,
  cwd,
}: {
  turn: Turn;
  rendered: TurnRender;
  policy: ActivityPresentationPolicy;
  activeTool: ActivityTool | undefined;
  isStreaming: boolean;
  cwd: string | null;
}) {
  if (
    activeTool ||
    !isStreaming ||
    !policy.showLatestThoughtStatus ||
    !rendered.currentThoughtText
  ) {
    return null;
  }

  return (
    <div
      className="min-w-0 text-fg-muted"
      data-current-activity={rendered.currentThoughtText}
    >
      <StreamingMarkdown
        key={
          rendered.timeline.findLast((item) => item.kind === "thought")
            ?.messageId ?? "thought"
        }
        turnId={turn.id}
        kind="thought"
        cwd={cwd}
        className="text-fg-muted"
        prefixSkip={Math.max(
          0,
          turn.thoughtText.length - rendered.currentThoughtText.length,
        )}
        paceReplay
      />
    </div>
  );
}
