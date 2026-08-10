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
import { pickToolActivityTarget } from "@/lib/chat-tool-presentation";
import { liveActivityState } from "@/lib/live-activity";
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();
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
  // Everything after the last thing the agent said is one stretch of work, and
  // the user reads it as one: "what it is doing now". Rendered as separate rows
  // it was a growing list of finished commands with the live line stranded at
  // the bottom, so the trailing run is merged into that live block instead.
  const lastSpokenIndex = rendered.timeline.reduce(
    (last, item, index) => (item.kind === "assistant_text" ? index : last),
    -1,
  );
  const trailingTools = [...toolGroups.byStartIndex.entries()]
    .filter(([index]) => index > lastSpokenIndex)
    .sort(([a], [b]) => a - b)
    .flatMap(([, tools]) => tools);
  const trailingToolIds = new Set(
    trailingTools.map((tool) => tool.toolCallId),
  );
  const liveTools = [...trailingTools, ...toolGroups.trailing];
  // One closed set of states, decided in one place. Every one of these used to
  // be its own boolean here, and the combinations nobody named are where the
  // duplicated sentences came from.
  const live = liveActivityState({
    rendered,
    isStreaming,
    liveTools,
    describeCommand: (tool) =>
      pickToolActivityTarget(tool, (name) => t("tool.skillSuffix", { name })),
  });
  const liveHeadline = live.kind === "running"
    ? live.command
    : live.kind === "tools"
      ? t("chat.runningTools")
      : live.kind === "waiting"
        ? t("chat.thinking")
        : undefined;
  // A command it is running is still a tool call and keeps the row's icon; the
  // fallback is the row talking about itself, and gets none.
  const liveHeadlineKind = live.kind === "running" || live.kind === "tools"
    ? ("command" as const)
    : live.kind === "waiting"
      ? ("thought" as const)
      : undefined;
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
            const isLiveTail =
              isStreaming && index === rendered.timeline.length - 1;
            // Where thinking is a passing state rather than part of the record,
            // only what the agent is thinking right now is drawn: the block
            // appears while it reasons and is gone once it moves on. Dropping
            // every thought instead — which is what this policy used to do —
            // meant the block was never drawn at all.
            if (!policy.persistThoughtTimeline && !isLiveTail) return null;
            // The agent's reasoning, rendered as the block it is. Marked so the
            // block itself is testable: it was policy-disabled for Codex and
            // squeezed into a single truncated line, and nothing failed.
            if (isLiveTail) {
              return (
                <div
                  key={`activity-thought-live-${item.messageId ?? index}`}
                  data-thought-block="true"
                >
                  <StreamingMarkdown
                    turnId={turn.id}
                    kind="thought"
                    cwd={cwd}
                    className="text-fg-muted"
                    paceReplay
                  />
                </div>
              );
            }
            return (
              <div
                key={`activity-thought-${item.messageId ?? index}`}
                data-thought-block="true"
              >
                <StreamdownText
                  className="font-chat text-[13px] leading-6 text-fg-muted"
                  text={item.text}
                  cwd={cwd}
                  sessionId={turn.sessionId}
                  surfacePrefix={`${turn.id}-thought-${index}`}
                />
              </div>
            );
          }
          const group = toolGroups.byStartIndex.get(index);
          if (!group) return null;
          // Merged into the live block below.
          if (group.some((tool) => trailingToolIds.has(tool.toolCallId))) {
            return null;
          }
          return (
            <ActivityToolGroup
              key={`activity-tools-${group.map((tool) => tool.toolCallId).join("-")}`}
              tools={group}
              sessionId={turn.sessionId}
              subagents={subagents}
            />
          );
        })}

        {/* One block for the current stretch of work: the tools that have run
            since the agent last spoke, and what it is doing now. Not either/or —
            a tool running is not a reason to stop saying what it is thinking. */}
        {/* One row for the current stretch of work. The tools that have run
            since the agent last spoke and the thought it is working from are one
            answer to "what is it doing"; two rows made them look like two, and
            the live line was stranded under a growing list of finished commands. */}
        <div data-activity-live-work="true" className="space-y-1">
          {liveTools.length > 0 ? (
            <ActivityToolGroup
              key={`activity-tools-live-${liveTools.map((tool) => tool.toolCallId).join("-")}`}
              tools={liveTools}
              sessionId={turn.sessionId}
              subagents={subagents}
              headline={liveHeadline}
              headlineKind={liveHeadlineKind}
            />
          ) : (
            <LiveStatusRow text={liveHeadline} />
          )}
        </div>
      </ReasoningContent>
    </Reasoning>
  );
}

function LiveStatusRow({ text }: { text?: string }) {
  const shown = useRef("");
  if (text) shown.current = text;
  if (!shown.current) return null;
  return (
    <div
      data-activity-status-row="true"
      className={cn(
        "grid min-w-0 text-fg-muted",
        "transition-[grid-template-rows,opacity] duration-[var(--dur-slow)] ease-[var(--ease-soft)]",
        text ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      aria-hidden={text ? undefined : true}
      {...(text ? { "data-current-activity": shown.current } : { inert: true })}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="py-0.5">
          <div className="activity-disclosure-row min-h-6">
            {/* One clamped line, not a streamed markdown block: the status only
                ever showed one truncated line. */}
            <p className="min-w-0 flex-1 truncate font-chat text-[13px] leading-6 text-fg-muted">
              {shown.current}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
