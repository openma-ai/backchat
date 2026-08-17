import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ListChecksIcon, Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { isToolRunning, type ActivityTool } from "@/lib/activity-tool-groups";
import {
  capitalizeToolLabel,
  pickToolActivityTarget,
  toolRunSummaryKeys,
  toolActivityVerbKey,
} from "@/lib/chat-tool-presentation";
import { useI18n } from "@/lib/i18n";
import { parseAcpEvent, type TurnRender } from "@/lib/reduce-turn";
import type { SubagentActivity, Turn } from "@/lib/session-store";
import { processTimelineEndIndex } from "@/lib/turn-timeline-sections";
import {
  CollapsibleEventSequence,
  type CollapsibleEventNode,
} from "./CollapsibleEventSequence";
import { ASSISTANT_MARKDOWN_CLASS, StreamdownText } from "./ChatMarkdown";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { projectThoughtEvent, ThoughtEventRow } from "./ThoughtEventRow";
import { ToolRow } from "./ToolPresentation";

/**
 * Collapses every part of a turn except its final answer. A turn containing
 * only a final answer has no process bar at all.
 */
export function TurnProcessBar({
  turn,
  rendered,
  subagents,
  isStreaming,
  cwd,
  leadingContent,
  trailingContent,
  hasSupplementalActivity = false,
}: {
  turn: Turn;
  rendered: TurnRender;
  subagents: SubagentActivity[];
  isStreaming: boolean;
  cwd: string | null;
  leadingContent?: ReactNode;
  trailingContent?: ReactNode;
  hasSupplementalActivity?: boolean;
}) {
  const { t } = useI18n();
  const [processOpen, setProcessOpen] = useState(isStreaming);
  const elapsedSeconds = useTurnElapsedSeconds(turn, isStreaming);
  useEffect(() => {
    // The process is live content while the turn is running, not a disclosure
    // the user can close. Once the turn settles it becomes a closed summary.
    setProcessOpen(isStreaming);
  }, [isStreaming]);
  const processEndIndex = processTimelineEndIndex(rendered.timeline);
  const processTextItems = rendered.timeline.filter(
    (item, index) => item.kind === "assistant_text" && index <= processEndIndex,
  );
  const hasThought = turn.thoughtText.trim().length > 0;
  const toolsById = new Map(
    rendered.tools.map((tool) => [tool.toolCallId, tool] as const),
  );
  const describeCommand = (tool: ActivityTool) =>
    pickToolActivityTarget(tool, (name) => t("tool.skillSuffix", { name }));
  const activityGroups = projectActivityEventGroups({
    rendered,
    toolsById,
  });
  const liveTail = rendered.timeline.at(-1);
  const isThinking = isStreaming && liveTail?.kind === "thought";
  const liveThoughtPrefix = isThinking
    ? Math.max(0, turn.thoughtText.length - liveTail.text.length)
    : 0;
  const isTextStreaming = isStreaming && liveTail?.kind === "assistant_text";
  const isToolProjectedRunning =
    isStreaming &&
    liveTail?.kind === "tool" &&
    isToolRunning(toolsById.get(liveTail.toolCallId)?.status);
  const showThinkingFallback =
    isStreaming && !isTextStreaming && !isThinking && !isToolProjectedRunning;
  const thoughtDurations = projectThoughtDurations(turn);
  const hasProcess =
    hasThought ||
    processTextItems.length > 0 ||
    rendered.tools.length > 0 ||
    hasSupplementalActivity ||
    showThinkingFallback;
  if (!hasProcess) return null;

  let assistantPrefix = 0;
  return (
    <Reasoning
      isStreaming={isStreaming}
      open={processOpen}
      onOpenChange={(open) => {
        if (!isStreaming) setProcessOpen(open);
      }}
    >
      <ReasoningTrigger
        disabled={isStreaming}
        aria-disabled={isStreaming}
        showIcon={false}
        getThinkingMessage={() => (
          <span className="min-w-0 flex-1 truncate text-left text-fg-muted">
            {t(isStreaming ? "chat.workingFor" : "chat.workedFor", {
              seconds: elapsedSeconds,
            })}
          </span>
        )}
      />
      <ReasoningContent>
        <div className="space-y-1">
          {leadingContent}
          {rendered.timeline.map((item, index) => {
            if (item.kind === "assistant_text") {
              const prefix = assistantPrefix;
              assistantPrefix += item.text.length;
              if (index > processEndIndex) return null;
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
            const group = activityGroups.get(index);
            if (!group) return null;
            const groupTools = group.flatMap((child) =>
              "tool" in child ? [child.tool] : [],
            );
            const completedSummaries = toolRunSummaryKeys(groupTools).map(
              (key) => t(key),
            );
            let active = false;
            const nodes: CollapsibleEventNode[] = group.map((child) => {
              if (!("tool" in child)) {
                const live =
                  isThinking && child.index === rendered.timeline.length - 1;
                active = live;
                const durationSeconds =
                  thoughtDurations.get(
                    thoughtTimingKey(child.item.messageId),
                  ) ?? 0;
                const projection = projectThoughtEvent({
                  turnId: turn.id,
                  text: child.item.text,
                  live,
                  prefixSkip: liveThoughtPrefix,
                  liveFallback: t("chat.thinking"),
                  completedLabel: t("chat.thoughtFor", {
                    seconds: durationSeconds,
                  }),
                });
                return {
                  key: child.item.messageId ?? `thought-${child.index}`,
                  projection,
                  content: (
                    <ThoughtEventRow
                      turn={turn}
                      text={child.item.text}
                      index={child.index}
                      cwd={cwd}
                      live={live}
                      prefixSkip={liveThoughtPrefix}
                      durationSeconds={durationSeconds}
                    />
                  ),
                };
              }
              const tool = child.tool;
              active =
                isStreaming &&
                child.index === rendered.timeline.length - 1 &&
                isToolRunning(tool.status);
              const target =
                describeCommand(tool) || tool.title || t("activity.tool");
              return {
                key: tool.toolCallId,
                projection: {
                  leading: isToolRunning(tool.status) ? (
                    <Loader2Icon className="chat-activity-icon animate-spin" />
                  ) : (
                    <ListChecksIcon className="chat-activity-icon" />
                  ),
                  summary: `${t(toolActivityVerbKey(tool))} ${target}`.trim(),
                },
                content: (
                  <ToolRow
                    tool={tool}
                    sessionId={turn.sessionId}
                    subagent={subagentForToolCall(subagents, tool.toolCallId)}
                  />
                ),
              };
            });
            return (
              <CollapsibleEventSequence
                key={`event-sequence-${index}`}
                nodes={nodes}
                active={active}
                completedProjection={{
                  leading: (
                    <ListChecksIcon className="chat-activity-icon text-fg-muted" />
                  ),
                  summary: capitalizeToolLabel(
                    completedSummaries.length > 0
                      ? completedSummaries.join(t("chat.toolRunJoin"))
                      : t("toolSummary.think"),
                  ),
                }}
              />
            );
          })}
          {showThinkingFallback && (
            <div className="py-0.5" data-thinking-fallback="true">
              <p
                className="min-h-6 truncate text-left font-chat text-[13px] leading-6 text-fg-muted"
                aria-live="polite"
              >
                {t("chat.thinking")}
              </p>
            </div>
          )}
          {trailingContent}
        </div>
      </ReasoningContent>
    </Reasoning>
  );
}

type TimelineItem = TurnRender["timeline"][number];
type ThoughtTimelineItem = Extract<TimelineItem, { kind: "thought" }>;
type ToolTimelineItem = Extract<TimelineItem, { kind: "tool" }>;

type ProjectedActivityChild =
  | { item: ThoughtTimelineItem; index: number }
  | { item: ToolTimelineItem; index: number; tool: ActivityTool };

function projectActivityEventGroups({
  rendered,
  toolsById,
}: {
  rendered: TurnRender;
  toolsById: ReadonlyMap<string, ActivityTool>;
}): ReadonlyMap<number, ProjectedActivityChild[]> {
  const groups = new Map<number, ProjectedActivityChild[]>();
  let start: number | undefined;
  let children: ProjectedActivityChild[] = [];
  const flush = () => {
    if (start !== undefined && children.length > 0) groups.set(start, children);
    start = undefined;
    children = [];
  };

  rendered.timeline.forEach((item, index) => {
    if (item.kind === "assistant_text") {
      flush();
      return;
    }
    if (item.kind === "thought") {
      if (start === undefined) start = index;
      children.push({ item, index });
      return;
    }
    const tool = toolsById.get(item.toolCallId);
    if (!tool) return;
    if (start === undefined) start = index;
    children.push({ item, index, tool });
  });
  flush();
  return groups;
}

function subagentForToolCall(
  subagents: SubagentActivity[],
  toolCallId: string,
): SubagentActivity | undefined {
  return subagents.find(
    (activity) => activity.native?.toolCallId === toolCallId,
  );
}

function thoughtTimingKey(messageId?: string): string {
  return messageId ? `message:${messageId}` : "anonymous";
}

function projectThoughtDurations(turn: Turn): ReadonlyMap<string, number> {
  const spans = new Map<string, { startedAt: number; lastIndex: number }>();
  turn.events.forEach((event, index) => {
    const parsed = parseAcpEvent(event.payload);
    if (parsed.kind !== "thought") return;
    const key = thoughtTimingKey(parsed.messageId);
    const span = spans.get(key);
    if (span) span.lastIndex = index;
    else spans.set(key, { startedAt: event.receivedAt, lastIndex: index });
  });

  return new Map(
    [...spans].map(([key, span]) => {
      const endedAt =
        turn.events[span.lastIndex + 1]?.receivedAt ??
        turn.endedAt ??
        Date.now();
      const seconds = Math.max(1, Math.ceil((endedAt - span.startedAt) / 1000));
      return [key, seconds] as const;
    }),
  );
}

function useTurnElapsedSeconds(turn: Turn, isStreaming: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  const eventEnd = turn.events.at(-1)?.receivedAt;
  const end = isStreaming ? now : (turn.endedAt ?? eventEnd ?? turn.startedAt);
  return Math.max(0, Math.ceil((end - turn.startedAt) / 1000));
}
