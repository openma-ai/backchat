import { memo, useMemo, type ReactNode } from "react";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { StatusNotice } from "@/components/ui/status-notice";
import { useI18n } from "@/lib/i18n";
import { reduceTurn } from "@/lib/reduce-turn";
import {
  selectAgentIdFor,
  selectSubagentsFor,
  sessionStore,
  useSessionStore,
  type SubagentActivity,
  type Turn,
} from "@/lib/session-store";
import {
  shouldShowTransientThought,
  turnWorkDurationSeconds,
} from "@/lib/turn-presentation";
import { useMarkdownCwd } from "./ChatMarkdown";
import { TurnAnswer } from "./TurnAnswer";
import { TurnActivity } from "./TurnActivity";
import { TurnPlan } from "./TurnPlan";

export const TurnBlock = memo(function TurnBlock({ turn }: { turn: Turn }) {
  const { t } = useI18n();
  const rendered = useMemo(() => reduceTurn(turn.events), [turn.events]);
  const cwd = useMarkdownCwd();
  const subagentsSelector = useMemo(
    () => selectSubagentsFor(turn.sessionId),
    [turn.sessionId],
  );
  const subagents = useSessionStore(subagentsSelector);
  const agentIdSelector = useMemo(
    () => selectAgentIdFor(turn.sessionId),
    [turn.sessionId],
  );
  const agentId = useSessionStore(agentIdSelector);
  const isStreaming = turn.status === "running";
  const hasVisibleContent =
    turn.assistantText.length > 0 ||
    rendered.tools.length > 0 ||
    rendered.plan.length > 0;
  const hasAnything =
    hasVisibleContent ||
    shouldShowTransientThought({
      isStreaming,
      thoughtText: turn.thoughtText,
      hasVisibleContent,
    });

  return (
    <div className="group/turn reveal-in mb-6 space-y-2" data-turn-id={turn.id}>
      {turn.promptText && (
        <Message from="user">
          <MessageContent>
            <p className="whitespace-pre-wrap">{turn.promptText}</p>
          </MessageContent>
        </Message>
      )}

      <div
        data-annotatable-response
        data-annotation-ready={!isStreaming}
        data-source-session-id={turn.sessionId}
        data-source-turn-id={turn.id}
        className="min-w-0"
      >
        <AssistantGutter>
          {rendered.plan.length > 0 && <TurnPlan entries={rendered.plan} />}

          <TurnActivity
            turn={turn}
            rendered={rendered}
            subagents={subagents}
            agentId={agentId}
            isStreaming={isStreaming}
            cwd={cwd}
            completeLabel={t("chat.workedFor", {
              seconds: turnWorkDurationSeconds(turn),
            })}
          />

          <TurnSubagentLinks
            turn={turn}
            renderedToolCallIds={rendered.tools.map((tool) => tool.toolCallId)}
            subagents={subagents}
          />

          <TurnAnswer
            turn={turn}
            rendered={rendered}
            cwd={cwd}
            isStreaming={isStreaming}
          />

          {!hasAnything && isStreaming && <StreamingPlaceholder />}
          {!hasAnything && turn.status === "queued" && (
            <p className="text-xs italic text-fg-subtle">queued</p>
          )}
          {turn.status === "error" && (
            <StatusNotice tone="danger">
              {turn.errorMessage ?? "Turn failed."}
            </StatusNotice>
          )}
          {turn.status === "cancelled" && (
            <p className="text-xs italic text-fg-subtle">cancelled</p>
          )}
        </AssistantGutter>
      </div>
    </div>
  );
});

function TurnSubagentLinks({
  turn,
  renderedToolCallIds,
  subagents,
}: {
  turn: Turn;
  renderedToolCallIds: string[];
  subagents: SubagentActivity[];
}) {
  const toolCallIds = new Set(renderedToolCallIds);
  const linkedSubagents = subagents.filter(
    (activity) =>
      activity.native?.toolCallId &&
      toolCallIds.has(activity.native.toolCallId),
  );
  if (linkedSubagents.length === 0) return null;

  const openSubagent = (activity: SubagentActivity) => {
    const label = subagentLinkLabel(activity);
    const existingTab = sessionStore.sideTabs().find(
      (tab) =>
        tab.type === "subagent" && tab.payload === activity.viewSessionId,
    );
    sessionStore.openSideTabForTask(
      turn.sessionId,
      "subagent",
      activity.viewSessionId,
      activity.native?.nickname || activity.task || label,
      existingTab?.id,
    );
  };

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
      data-subagent-links
    >
      {linkedSubagents.map((activity) => {
        const label = subagentLinkLabel(activity);
        return (
          <button
            key={activity.viewSessionId}
            type="button"
            data-subagent-link={activity.viewSessionId}
            className="rounded-sm text-info underline underline-offset-4 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => openSubagent(activity)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function subagentLinkLabel(activity: SubagentActivity): string {
  const label =
    activity.native?.nickname ||
    activity.task.split("/").filter(Boolean).at(-1) ||
    activity.childSessionId;
  return /^[a-z]$/i.test(label) ? `Agent ${label.toUpperCase()}` : label;
}

function StreamingPlaceholder() {
  return (
    <p
      className="text-sm font-normal leading-6 text-fg-muted"
      aria-label="Thinking..."
      aria-live="polite"
    >
      <span aria-hidden="true">
        Thinking
        <span className="thinking-placeholder-dot">.</span>
        <span
          className="thinking-placeholder-dot"
          style={{ animationDelay: "180ms" }}
        >
          .
        </span>
        <span
          className="thinking-placeholder-dot"
          style={{ animationDelay: "360ms" }}
        >
          .
        </span>
      </span>
    </p>
  );
}

function AssistantGutter({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-2">{children}</div>;
}
