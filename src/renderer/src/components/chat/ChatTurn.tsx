import { memo, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AtSignIcon } from "lucide-react";
import { SessionTurnFrame } from "@openma/common/session-ui";
import { StatusNotice } from "@/components/ui/status-notice";
import { useI18n } from "@/lib/i18n";
import { reduceTurn, type TurnRender } from "@/lib/reduce-turn";
import {
  latestPlanDocumentForEvents,
  latestTaskListForTurns,
} from "@/lib/session-plan";
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
import { PlanDocumentActivity } from "./PlanDocumentActivity";
import { TaskListActivity } from "./TaskListActivity";
import {
  inspectRawTurnEvents,
  RawEventInspector,
} from "./RawEventInspector";

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
  const planDocument = useMemo(
    () => latestPlanDocumentForEvents(turn.events, agentId),
    [agentId, turn.events],
  );
  const activityRendered = useMemo<TurnRender>(() => {
    if (!planDocument?.sourceToolCallId) return rendered;
    const sourceToolCallId = planDocument.sourceToolCallId;
    return {
      ...rendered,
      tools: rendered.tools.filter(
        (tool) => tool.toolCallId !== sourceToolCallId,
      ),
      timeline: rendered.timeline.filter(
        (item) =>
          item.kind !== "tool" || item.toolCallId !== sourceToolCallId,
      ),
    };
  }, [planDocument?.sourceToolCallId, rendered]);
  const taskPlanEntries = useMemo(() => {
    const entries = latestTaskListForTurns(agentId, [turn]);
    return planDocument
      ? entries.filter((entry) => entry.content !== planDocument.markdown)
      : entries;
  }, [agentId, planDocument, turn]);
  const isStreaming = turn.status === "running";
  const rawEvents = useMemo(
    () => inspectRawTurnEvents(turn.events),
    [turn.events],
  );
  const hasVisibleContent =
    turn.assistantText.length > 0 ||
    activityRendered.tools.length > 0 ||
    taskPlanEntries.length > 0 ||
    rawEvents.length > 0 ||
    !!planDocument;
  const hasAnything =
    hasVisibleContent ||
    shouldShowTransientThought({
      isStreaming,
      thoughtText: turn.thoughtText,
      hasVisibleContent,
    });
  const hasSessionReferences = (turn.sessionReferences?.length ?? 0) > 0;

  return (
    <>
      {hasSessionReferences && <ReferencedSessionPrompt turn={turn} />}
      <SessionTurnFrame
        turnId={turn.id}
        sessionId={turn.sessionId}
        promptText={hasSessionReferences ? undefined : turn.promptText}
        status={turn.status}
        errorMessage={turn.errorMessage}
        className="!mb-8 !space-y-4 [&_[data-session-turn-prompt]>div]:!px-3 [&_[data-session-turn-prompt]>div]:!py-2"
        errorNotice={
          turn.status === "error" ? (
            <StatusNotice tone="danger">
              {turn.errorMessage ?? "Turn failed."}
            </StatusNotice>
          ) : undefined
        }
      >
          {planDocument && (
            <PlanDocumentActivity
              document={planDocument}
              cwd={cwd}
              sessionId={turn.sessionId}
            />
          )}

          {taskPlanEntries.length > 0 && (
            <TaskListActivity
              items={taskPlanEntries.map((entry) => ({
                label: entry.content,
                status: entry.status,
              }))}
            />
          )}

          <TurnActivity
            turn={turn}
            rendered={activityRendered}
            subagents={subagents}
            agentId={agentId}
            isStreaming={isStreaming}
            cwd={cwd}
            completeLabel={t("chat.workedFor", {
              seconds: turnWorkDurationSeconds(turn),
            })}
          />

          <RawEventInspector events={rawEvents} />

          <TurnSubagentLinks
            turn={turn}
            renderedToolCallIds={activityRendered.tools.map(
              (tool) => tool.toolCallId,
            )}
            subagents={subagents}
          />

          <TurnAnswer
            turn={turn}
            rendered={rendered}
            cwd={cwd}
            isStreaming={isStreaming}
          />

          {!hasAnything && isStreaming && <StreamingPlaceholder />}
      </SessionTurnFrame>
    </>
  );
});

function ReferencedSessionPrompt({ turn }: { turn: Turn }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const references = turn.sessionReferences ?? [];

  return (
    <div
      className="group is-user mb-2 ml-auto flex w-full max-w-[95%] flex-col items-end gap-2"
      data-session-turn-prompt="true"
    >
      <div className="ml-auto flex w-fit min-w-0 max-w-full flex-wrap items-center gap-1.5 overflow-hidden rounded-lg bg-secondary px-4 py-3 text-sm text-foreground">
        {references.map((reference) => (
          <button
            key={reference.session_id}
            type="button"
            data-session-reference={reference.session_id}
            aria-label={`${t("chat.openSessionReference")}: ${reference.title}`}
            title={`${t("chat.openSessionReference")}: ${reference.title}`}
            onClick={() => {
              void navigate({
                to: "/chat/$sessionId",
                params: { sessionId: reference.session_id },
              });
            }}
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg bg-info/10 px-2 text-xs font-medium text-info ring-1 ring-info/25 hover:bg-info/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/45"
          >
            <AtSignIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{reference.title}</span>
          </button>
        ))}
        {turn.promptText && (
          <p className="whitespace-pre-wrap">{turn.promptText}</p>
        )}
      </div>
    </div>
  );
}

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
