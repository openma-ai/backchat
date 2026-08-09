import { turnStopNotice } from "@/lib/turn-stop-reason";
import { memo, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightFromLineIcon, AtSignIcon, TargetIcon } from "lucide-react";
import { SessionTurnFrame } from "@openma/common/session-ui";
import { StatusNotice } from "@/components/ui/status-notice";
import { useI18n } from "@/lib/i18n";
import { reduceTurn, type TurnRender } from "@/lib/reduce-turn";
import { settleInterruptedToolStatus } from "@/lib/chat-tool-presentation";
import { promptCommandAnnotation } from "@/lib/prompt-command-annotation";
import { latestPlanDocumentForEvents } from "@/lib/session-plan";
import { subagentActivityLabel } from "@/lib/session-workspace-normalization";
import {
  selectAgentIdFor,
  selectAvailableCommandsFor,
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
import {
  inspectRawTurnEvents,
  RawEventInspector,
} from "./RawEventInspector";

export const TurnBlock = memo(function TurnBlock({
  turn,
  onFork,
}: {
  turn: Turn;
  onFork?: () => void;
}) {
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
    // A turn that stopped running will never receive another tool update, so
    // settle anything still mid-flight instead of spinning forever. This also
    // covers restarts, where the same events replay from disk unchanged.
    const settled = turn.status === "running"
      ? rendered
      : {
          ...rendered,
          tools: rendered.tools.map((tool) => ({
            ...tool,
            status: settleInterruptedToolStatus(tool.status),
          })),
        };
    if (!planDocument?.sourceToolCallId) return settled;
    const sourceToolCallId = planDocument.sourceToolCallId;
    return {
      ...settled,
      tools: settled.tools.filter(
        (tool) => tool.toolCallId !== sourceToolCallId,
      ),
      timeline: settled.timeline.filter(
        (item) =>
          item.kind !== "tool" || item.toolCallId !== sourceToolCallId,
      ),
    };
  }, [planDocument?.sourceToolCallId, rendered, turn.status]);
  const isStreaming = turn.status === "running";
  // The agent states why a turn ended; a limit or a refusal arrives as an
  // ordinary completion and would otherwise read as a finished answer.
  const stopNotice = turnStopNotice(turn);
  const rawEvents = useMemo(
    () => inspectRawTurnEvents(turn.events),
    [turn.events],
  );
  const hasVisibleContent =
    turn.assistantText.length > 0 ||
    activityRendered.tools.length > 0 ||
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
  const availableCommandsSelector = useMemo(
    () => selectAvailableCommandsFor(turn.sessionId),
    [turn.sessionId],
  );
  const availableCommands = useSessionStore(availableCommandsSelector);
  // The composer prefixed `/goal ` for the user, so the wire text is not what
  // they typed. Show the argument as the message and name the command beside
  // it instead of echoing plumbing back at them.
  const commandInvocation = useMemo(
    () => promptCommandAnnotation(turn.promptText, agentId, availableCommands),
    [agentId, availableCommands, turn.promptText],
  );

  return (
    <>
      {hasSessionReferences && <ReferencedSessionPrompt turn={turn} />}
      <SessionTurnFrame
        turnId={turn.id}
        sessionId={turn.sessionId}
        promptText={
          hasSessionReferences
            ? undefined
            : commandInvocation?.body ?? turn.promptText
        }

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
          {commandInvocation && !hasSessionReferences && (
            // Sits directly under the prompt bubble: the frame renders children
            // after it. Right-aligned to stay with the message it describes.
            <p
              className="ml-auto flex w-fit items-center gap-1.5 text-xs text-fg-muted"
              data-prompt-command={commandInvocation.command}
            >
              <TargetIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{t("chat.sentAsGoal")}</span>
            </p>
          )}

          {planDocument && (
            <PlanDocumentActivity
              document={planDocument}
              cwd={cwd}
              sessionId={turn.sessionId}
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

          {onFork && turn.status === "complete" && turn.assistantText.trim() && (
            <button
              type="button"
              data-turn-fork-action="true"
              aria-label={t("chat.continueInNewChat")}
              title={t("chat.continueInNewChat")}
              onClick={onFork}
              className="ml-auto inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowRightFromLineIcon className="size-4" aria-hidden="true" />
            </button>
          )}

          {stopNotice && (
            <p
              data-turn-stop-reason={turn.stopReason}
              className={
                stopNotice.tone === "refused"
                  ? "text-xs leading-5 text-fg-muted"
                  : "text-xs leading-5 text-warning"
              }
            >
              {t(stopNotice.key)}
            </p>
          )}

          {isStreaming && (
            hasAnything
              // A running turn has to look running for as long as it runs.
              // Gating the only signal on "nothing visible yet" meant the first
              // token made a turn mid-sentence look finished, which is what
              // invited the next prompt on top of it. With content present the
              // wait is a continuation, so it trails the output as motion
              // alone: repeating the word would read as starting over, and a
              // heading above live activity is what this deliberately is not.
              ? <StreamingContinuation />
              : <StreamingPlaceholder />
          )}
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
      label,
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
  return subagentActivityLabel(activity);
}

function StreamingDots({ hidden }: { hidden?: boolean }) {
  return (
    <span aria-hidden={hidden === false ? undefined : "true"}>
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
  );
}

/** The tail of a turn that is still producing output. Carries no words: the
 *  output above it already says what is happening. */
function StreamingContinuation() {
  const { t } = useI18n();
  return (
    <p
      data-streaming-continuation="true"
      className="text-sm leading-6 text-fg-subtle"
      aria-label={t("chat.stillWorking")}
      aria-live="polite"
    >
      <StreamingDots />
    </p>
  );
}

function StreamingPlaceholder() {
  const { t } = useI18n();
  const label = t("chat.thinking");
  // The translation carries its own ellipsis ("Thinking…" / "思考中…"); the
  // animated dots replace it so the wait reads as motion in either language.
  const stem = label.replace(/[.…。]+\s*$/u, "");
  return (
    <p
      className="text-sm font-normal leading-6 text-fg-muted"
      aria-label={label}
      aria-live="polite"
    >
      <span aria-hidden="true">
        {stem}
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
