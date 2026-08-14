import { turnStopNotice } from "@/lib/turn-stop-reason";
import { memo, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightFromLineIcon,
  AtSignIcon,
  CheckIcon,
  CopyIcon,
  TargetIcon,
} from "lucide-react";
import { SessionTurnFrame } from "@openma/common/session-ui";
import { StatusNotice } from "@/components/ui/status-notice";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
import { shouldShowTransientThought } from "@/lib/turn-presentation";
import { useMarkdownCwd } from "./ChatMarkdown";
import { TurnAnswer } from "./TurnAnswer";
import { TurnProcessBar } from "./TurnActivity";
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

          <TurnProcessBar
            turn={turn}
            rendered={activityRendered}
            subagents={subagents}
            isStreaming={isStreaming}
            cwd={cwd}
            hasSupplementalActivity={
              Boolean(planDocument) ||
              rawEvents.length > 0 ||
              hasTurnSubagentLinks(activityRendered, subagents)
            }
            leadingContent={planDocument ? (
              <PlanDocumentActivity
                document={planDocument}
                cwd={cwd}
                sessionId={turn.sessionId}
              />
            ) : undefined}
            trailingContent={(
              <>
                <RawEventInspector events={rawEvents} />
                <TurnSubagentLinks
                  turn={turn}
                  renderedToolCallIds={activityRendered.tools.map(
                    (tool) => tool.toolCallId,
                  )}
                  subagents={subagents}
                />
              </>
            )}
          />

          <TurnAnswer
            turn={turn}
            rendered={rendered}
            cwd={cwd}
            isStreaming={isStreaming}
          />

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

          {/* One row that outlives the turn's state change. The running layer is
              intentionally empty: live state belongs to its atomic event row. */}
          <TurnFooter
            turn={turn}
            isStreaming={isStreaming}
            onFork={onFork}
          />
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
      {/* The prompt's own time and copy, mirrored to its side of the column. */}
      <div
        data-session-turn-prompt-meta="true"
        className="flex min-h-6 items-center justify-end gap-1"
      >
        <TurnMetaActions
          timestamp={turn.startedAt}
          copyText={turn.promptText ?? ""}
          align="end"
        />
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

function hasTurnSubagentLinks(
  rendered: TurnRender,
  subagents: SubagentActivity[],
): boolean {
  const toolCallIds = new Set(
    rendered.tools.map((tool) => tool.toolCallId),
  );
  return subagents.some(
    (activity) =>
      activity.native?.toolCallId &&
      toolCallIds.has(activity.native.toolCallId),
  );
}

function subagentLinkLabel(activity: SubagentActivity): string {
  return subagentActivityLabel(activity);
}

/** The tail of a turn that is still producing output.
 *
 * It used to be dots alone, on the reasoning that repeating the word would read
 * as the agent starting over. In practice a bare "..." says nothing: the line has
 * to name the state it is reporting, and the animation is what makes it read as
 * ongoing rather than stalled. */
/** The time a message landed plus the actions that belong to it. One row, so
 *  the prompt and the answer read as the same kind of thing on either side. */
function TurnMetaActions({
  timestamp,
  copyText,
  align,
  children,
}: {
  timestamp?: number;
  copyText: string;
  align: "start" | "end";
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!copyText) return;
    void navigator.clipboard?.writeText(copyText).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <>
      {timestamp !== undefined && (
        <time
          data-turn-timestamp={String(timestamp)}
          className={cn(
            "text-xs leading-5 text-fg-subtle",
            align === "start" ? "mr-1" : "ml-1",
          )}
        >
          {new Date(timestamp).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      )}
      {copyText.length > 0 && (
        <button
          type="button"
          data-turn-copy-action="true"
          aria-label={copied ? t("chat.answerCopied") : t("chat.copyAnswer")}
          title={copied ? t("chat.answerCopied") : t("chat.copyAnswer")}
          onClick={copy}
          className="inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <CheckIcon className="size-4" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-4" aria-hidden="true" />
          )}
        </button>
      )}
      {children}
    </>
  );
}

function TurnFooter({
  turn,
  isStreaming,
  onFork,
}: {
  turn: Turn;
  isStreaming: boolean;
  onFork?: () => void;
}) {
  const { t } = useI18n();
  const answer = turn.assistantText.trim();
  const canFork = Boolean(onFork) && turn.status === "complete" && answer.length > 0;
  const endedAt = turn.status === "running" ? undefined : turn.endedAt;
  const layer =
    "col-start-1 row-start-1 flex min-w-0 items-center transition-opacity duration-[var(--dur-slow)] ease-[var(--ease-soft)]";
  return (
    <div
      data-turn-footer="true"
      // A fixed height, not a minimum: the actions layer is laid out even while
      // it is transparent, so the row grew by the height of a button the moment
      // there was an answer to copy — and everything below it moved.
      className="grid h-7 grid-cols-1 grid-rows-1"
    >
      <div
        className={cn(layer, isStreaming ? "opacity-100" : "pointer-events-none opacity-0")}
        aria-hidden={isStreaming ? undefined : true}
      >
      </div>
      <div
        className={cn(
          layer,
          // Left, with the transcript's own text. The answer's own actions do not
          // belong on the prompt's side of the column.
          "justify-start gap-1",
          isStreaming ? "pointer-events-none opacity-0" : "opacity-100",
        )}
        aria-hidden={isStreaming ? true : undefined}
      >
        <TurnMetaActions timestamp={endedAt} copyText={answer} align="start">
          {canFork && (
            <button
              type="button"
              data-turn-fork-action="true"
              aria-label={t("chat.continueInNewChat")}
              title={t("chat.continueInNewChat")}
              onClick={onFork}
              className="inline-flex size-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowRightFromLineIcon className="size-4" aria-hidden="true" />
            </button>
          )}
        </TurnMetaActions>
      </div>
    </div>
  );
}
