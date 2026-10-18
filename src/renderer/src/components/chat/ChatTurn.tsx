import { ComposerAnnotationStrip } from "./ComposerAnnotations";
import { turnStopNotice } from "@/lib/turn-stop-reason";
import { memo, useMemo } from "react";
import {
  GitBranchIcon,
  ListChecksIcon,
  Loader2Icon,
  RotateCcwIcon,
  TargetIcon,
} from "@/components/Icons";
import { AgentUITurnView, projectAcpChatTurn } from "@openma/common/chat-ui";
import type {
  AgentUIMessageItem,
  AgentUIToolItem,
} from "@openma/common/agent-ui";
import { StatusNotice } from "@/components/ui/status-notice";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type TurnRender } from "@/lib/reduce-turn";
import {
  capitalizeToolLabel,
  pickToolActivityTarget,
  settleInterruptedToolStatus,
  toolActivityVerbKey,
  toolRunSummaryKeys,
} from "@/lib/chat-tool-presentation";
import { promptCommandAnnotation } from "@/lib/prompt-command-annotation";
import { latestPlanDocumentForRender } from "@/lib/session-plan";
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
  ASSISTANT_MARKDOWN_CLASS,
  StreamdownText,
  useMarkdownCwd,
} from "./ChatMarkdown";
import { PlanDocumentActivity } from "./PlanDocumentActivity";
import { TurnScheduleCards } from "./ScheduledTaskMessageBar";
import { parseScheduledTaskPrompt } from "@/lib/scheduled-task-presentation";
import { inspectRawTurnEvents, RawEventInspector } from "./RawEventInspector";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { projectThoughtEvent, ThoughtEventRow } from "./ThoughtEventRow";
import { ToolRow } from "./ToolPresentation";
import {
  ReferencedSessionPrompt,
  ScheduledTaskUserPrompt,
  TurnMetaActions,
  TURN_ACTION_BUTTON,
  TURN_ACTION_ICON,
  UserPromptBubble,
} from "./UserPromptBubble";
import { BACKCHAT_COLLAPSIBLE_PRIMITIVES } from "@/components/ai-elements/reasoning";

export const TurnBlock = memo(function TurnBlock({
  turn,
  onFork,
  onForkTurn,
  forkLabel,
  onRetrySend,
  onRegenerate,
  onEditPrompt,
  defaultProcessOpen,
  hideErrorNotice = false,
  isLatest = true,
}: {
  turn: Turn;
  onFork?: () => void;
  onForkTurn?: (turnId: string) => void;
  forkLabel?: string;
  onRetrySend?: (turn: Turn) => void;
  onRegenerate?: (turn: Turn) => void;
  onEditPrompt?: (turn: Turn, nextPromptText: string) => void;
  /** Render a settled turn's process strip expanded on first mount. */
  defaultProcessOpen?: boolean;
  /** The same error already stands above the composer; don't repeat it. */
  hideErrorNotice?: boolean;
  /** The newest turn keeps its footer actions visible; older ones show
   *  them on hover. */
  isLatest?: boolean;
}) {
  const { t } = useI18n();
  const rendered = sessionStore.projectTurn(turn);
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
    () => latestPlanDocumentForRender(rendered, agentId),
    [agentId, rendered],
  );
  const activityRendered = useMemo<TurnRender>(() => {
    // A turn that stopped running will never receive another tool update, so
    // settle anything still mid-flight instead of spinning forever. This also
    // covers restarts, where the same events replay from disk unchanged.
    const needsToolSettle =
      turn.status !== "running" &&
      rendered.tools.some(
        (tool) => settleInterruptedToolStatus(tool.status) !== tool.status,
      );
    const settled = needsToolSettle
      ? {
          ...rendered,
          tools: rendered.tools.map((tool) => ({
            ...tool,
            status: settleInterruptedToolStatus(tool.status),
          })),
        }
      : rendered;
    if (!planDocument?.sourceToolCallId) return settled;
    const sourceToolCallId = planDocument.sourceToolCallId;
    return {
      ...settled,
      tools: settled.tools.filter(
        (tool) => tool.toolCallId !== sourceToolCallId,
      ),
      timeline: settled.timeline.filter(
        (item) => item.kind !== "tool" || item.toolCallId !== sourceToolCallId,
      ),
    };
  }, [planDocument?.sourceToolCallId, rendered, turn.status]);
  const sendPending = turn.sendState === "pending";
  const sendFailed = turn.sendState === "failed";
  const isStreaming = turn.status === "running" && !sendPending && !sendFailed;
  // The agent states why a turn ended; a limit or a refusal arrives as an
  // ordinary completion and would otherwise read as a finished answer.
  const stopNotice = turnStopNotice(turn);
  const rawEvents = useMemo(
    () => inspectRawTurnEvents(turn.events),
    [turn.events],
  );
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
  const scheduledPrompt = useMemo(
    () => parseScheduledTaskPrompt(turn.promptText),
    [turn.promptText],
  );
  const projectedTurn = useMemo(
    () =>
      projectAcpChatTurn(
        {
          id: turn.id,
          promptText:
            hasSessionReferences || scheduledPrompt || (!!turn.annotations?.length && /^\[\d+ annotations?\]$/.test(turn.promptText.trim()))
              ? ""
              : (commandInvocation?.body ?? turn.promptText),
          attachments: turn.attachments,
          events: turn.events,
          assistantText: turn.assistantText,
          status: sendFailed ? "error" : sendPending ? "complete" : turn.status,
          errorMessage: sendFailed ? (turn.sendError ?? turn.errorMessage) : turn.errorMessage,
          startedAt: turn.startedAt,
          endedAt: turn.endedAt,
        },
        { rendered: activityRendered },
      ),
    [
      activityRendered,
      commandInvocation?.body,
      hasSessionReferences,
      scheduledPrompt,
      turn.assistantText,
      turn.annotations,
      turn.attachments,
      turn.endedAt,
      turn.errorMessage,
      turn.events,
      turn.id,
      turn.promptText,
      sendFailed,
      sendPending,
      turn.sendError,
      turn.startedAt,
      turn.status,
    ],
  );
  const activityToolsById = useMemo(
    () =>
      new Map(
        activityRendered.tools.map((tool) => [tool.toolCallId, tool] as const),
      ),
    [activityRendered.tools],
  );

  const supplementalProcess =
    Boolean(planDocument) ||
    rawEvents.length > 0 ||
    hasTurnSubagentLinks(activityRendered, subagents);
  const resolvedOnFork = useMemo(
    () => (onForkTurn ? () => onForkTurn(turn.id) : onFork),
    [onFork, onForkTurn, turn.id],
  );
  const resolvedOnRegenerate = useMemo(
    () => (onRegenerate ? () => onRegenerate(turn) : undefined),
    [onRegenerate, turn],
  );
  // Every plain prompt uses one bubble so its time · copy (· edit) row is
  // the same component, with the same footprint, on every turn.
  const useCustomPromptRenderer = true;

  const view = (
    <AgentUITurnView
      // chat-ui keeps a settled turn's process strip as it was while
      // streaming (open). Remount once when the turn stops running so it
      // re-initializes from defaultProcessOpen: each turn folds its work
      // away when it finishes, leaving the answer.
      key={turn.status === "running" ? "live" : "settled"}
      sessionId={turn.sessionId}
      turn={projectedTurn}
      frameStatus={sendFailed ? "error" : sendPending ? "completed" : turn.status}
      thoughts="history"
      activityTools="all"
      collapsiblePrimitives={BACKCHAT_COLLAPSIBLE_PRIMITIVES}
      defaultProcessOpen={defaultProcessOpen}
      labels={{
        workingFor: (seconds) => t("chat.workingFor", { seconds }),
        workedFor: (seconds) => t("chat.workedFor", { seconds }),
        thinking: t("chat.thinking"),
        thoughtFor: (seconds) => t("chat.thoughtFor", { seconds }),
        toolActivity: (tool) => describeProjectedTool(tool, t),
        toolRunSummary: (tools) => describeProjectedToolRun(tools, t),
      }}
      slots={{
        renderBeforeTurn: () => (
          <>
            {!!turn.annotations?.length && (
              <div data-prompt-annotations className="mb-2 flex justify-end">
                <ComposerAnnotationStrip annotations={turn.annotations} attachments={turn.attachments ?? []} />
              </div>
            )}
            {hasSessionReferences && <ReferencedSessionPrompt turn={turn} />}
            {scheduledPrompt && !hasSessionReferences && (
              <ScheduledTaskUserPrompt turn={turn} surface={scheduledPrompt} />
            )}
          </>
        ),
        ...(useCustomPromptRenderer
          ? {
              renderPrompt: ({ item }: { item: AgentUIMessageItem }) => (
                <UserPromptBubble
                  turn={turn}
                  text={item.text}
                  onEditPrompt={onEditPrompt}
                />
              ),
            }
          : {}),
        renderAssistant: ({ item, section, live, prefixSkip }) =>
          live ? (
            <StreamingMarkdown
              key={`${turn.id}:${turn.streamRevision ?? 0}`}
              turnId={turn.id}
              kind="assistant"
              cwd={cwd}
              prefixSkip={prefixSkip}
              paceReplay
            />
          ) : (
            <StreamdownText
              className={ASSISTANT_MARKDOWN_CLASS}
              text={item.text}
              cwd={cwd}
              sessionId={turn.sessionId}
              surfacePrefix={assistantSurfacePrefix(turn.id, item, section)}
            />
          ),
        projectThoughtActivity: ({ item, live }) =>
          projectThoughtEvent({
            live,
            liveFallback: t("chat.thinking"),
            completedLabel: t("chat.thoughtFor", {
              seconds: itemContentNumber(item, "durationSeconds"),
            }),
          }),
        renderThought: ({ item, live, prefixSkip }) => (
          <ThoughtEventRow
            turn={turn}
            text={item.text}
            index={itemContentNumber(item, "timelineIndex")}
            cwd={cwd}
            live={live}
            prefixSkip={prefixSkip}
            durationSeconds={itemContentNumber(item, "durationSeconds")}
          />
        ),
        projectToolActivity: ({ tool, live }) => ({
          leading:
            live || isProjectedToolRunning(tool) ? (
              <Loader2Icon className="chat-activity-icon animate-spin" />
            ) : (
              <ListChecksIcon className="chat-activity-icon" />
            ),
          summary: describeProjectedTool(tool, t, live),
        }),
        projectToolRun: ({ tools }) => ({
          leading: (
            <ListChecksIcon className="chat-activity-icon text-fg-muted" />
          ),
          summary: describeProjectedToolRun(tools, t),
        }),
        renderTool: ({ tool }) => {
          const activityTool = activityToolsById.get(tool.id);
          return activityTool ? (
            <ToolRow
              tool={activityTool}
              sessionId={turn.sessionId}
              subagent={subagents.find(
                (activity) => activity.native?.toolCallId === tool.id,
              )}
            />
          ) : null;
        },
        // The turn did end in failure, so the stream keeps a mark — but one
        // quiet line, not a card. Retry lives in the footer's icon row.
        renderError: ({ message }) => hideErrorNotice ? null : (
          <StatusNotice
            tone="danger"
            appearance="quiet"
            data-turn-error-fallback="true"
            title={message || undefined}
          >
            {message || t("chat.sessionErrored")}
          </StatusNotice>
        ),
        renderResponseBeforeProcess: () =>
          commandInvocation && !hasSessionReferences && !scheduledPrompt ? (
            <p
              className="ml-auto flex w-fit items-center gap-1.5 text-xs text-fg-muted"
              data-prompt-command={commandInvocation.command}
            >
              <TargetIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{t("chat.sentAsGoal")}</span>
            </p>
          ) : null,
        hasSupplementalProcess: () => supplementalProcess,
        renderProcessBefore: () =>
          planDocument ? (
            <PlanDocumentActivity
              document={planDocument}
              cwd={cwd}
              sessionId={turn.sessionId}
            />
          ) : null,
        renderProcessAfter: () => (
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
        ),
        renderAfterAnswer: () => (
          <>
            <TurnScheduleCards
              sessionId={turn.sessionId}
              tools={activityRendered.tools}
            />
            {sendPending ? (
              <>
                {/* Once the turn runs, chat-ui puts the "Working for" header
                    above the "Thinking…" fallback. Hold that header's exact
                    box (same classes, invisible) so "Sending…" already sits
                    where "Thinking…" will appear and nothing shifts. */}
                <div
                  className="not-prose invisible"
                  aria-hidden="true"
                  inert
                  data-send-pending-header-slot="true"
                >
                  {/* A button so the header's button-scoped rules (padding,
                      hairline, row font) give it the identical height. */}
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled
                    className="chat-interactive-surface chat-reasoning-trigger activity-disclosure-row flex w-full select-none items-center gap-2 text-sm chat-interactive-surface--transcript"
                  >
                    <span className="chat-transcript-disclosure-summary min-w-0 flex-1 truncate text-left">
                      {"\u00a0"}
                    </span>
                  </button>
                </div>
                {/* Same row as chat-ui's "Thinking…" fallback: the handoff
                    swaps text without a size or height change. */}
                <p
                  className="min-h-6 truncate text-left font-chat text-[13px] leading-6 text-fg-muted"
                  role="status"
                  aria-live="polite"
                  data-user-echo-status="pending"
                >
                  {t("chat.sending")}
                </p>
              </>
            ) : null}
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
          </>
        ),
        renderFooter: () => (
          <TurnFooter
            turn={turn}
            isStreaming={isStreaming}
            onFork={resolvedOnFork}
            forkLabel={forkLabel}
            onRegenerate={resolvedOnRegenerate}
            failed={sendFailed || turn.status === "error"}
            onRetrySend={sendFailed && onRetrySend ? () => onRetrySend(turn) : undefined}
            isLatest={isLatest}
          />
        ),
      }}
    />
  );
  if (!turn.sendState) return view;
  return (
    <div
      className="contents"
      data-user-echo={turn.sendState}
      data-client-id={turn.clientId}
    >
      {view}
    </div>
  );
});

type Translate = ReturnType<typeof useI18n>["t"];

function projectedToolPresentation(tool: AgentUIToolItem) {
  return {
    kind: tool.toolKind,
    status: tool.status,
    title: tool.title,
    meta: tool.adapterMeta,
    locations: tool.locations,
    content: tool.content as
      | Array<{
          type: string;
          path?: string;
          content?: { type?: string; text?: string };
        }>
      | undefined,
    rawInput: tool.rawInput,
  };
}

function describeProjectedTool(
  tool: AgentUIToolItem,
  t: Translate,
  live = false,
): string {
  const projected = {
    ...projectedToolPresentation(tool),
    status: live ? "in_progress" : tool.status,
  };
  const target =
    pickToolActivityTarget(projected, (name) =>
      t("tool.skillSuffix", { name }),
    ) ||
    tool.title ||
    t("activity.tool");
  return `${t(toolActivityVerbKey(projected))} ${target}`.trim();
}

function describeProjectedToolRun(
  tools: readonly AgentUIToolItem[],
  t: Translate,
): string {
  const summaries = toolRunSummaryKeys(
    tools.map(projectedToolPresentation),
  ).map((key) => t(key));
  return capitalizeToolLabel(
    summaries.length > 0
      ? summaries.join(t("chat.toolRunJoin"))
      : t("toolSummary.think"),
  );
}

function isProjectedToolRunning(tool: AgentUIToolItem): boolean {
  return tool.status === "pending" || tool.status === "in_progress";
}

function itemContentNumber(
  item: AgentUIMessageItem,
  key: "timelineIndex" | "durationSeconds",
): number {
  if (!item.content || typeof item.content !== "object") return 0;
  const value = (item.content as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

function assistantSurfacePrefix(
  turnId: string,
  item: AgentUIMessageItem,
  section: "process" | "answer",
): string {
  if (
    item.content &&
    typeof item.content === "object" &&
    (item.content as Record<string, unknown>).replay === true
  ) {
    return `${turnId}-replay`;
  }
  return `${turnId}-${section === "process" ? "activity" : "answer"}-${itemContentNumber(
    item,
    "timelineIndex",
  )}`;
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
    const existingTab = sessionStore
      .sideTabs()
      .find(
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
  const toolCallIds = new Set(rendered.tools.map((tool) => tool.toolCallId));
  return subagents.some(
    (activity) =>
      activity.native?.toolCallId &&
      toolCallIds.has(activity.native.toolCallId),
  );
}

function subagentLinkLabel(activity: SubagentActivity): string {
  return subagentActivityLabel(activity);
}

function TurnFooter({
  turn,
  isStreaming,
  onFork,
  forkLabel,
  onRegenerate,
  failed = false,
  onRetrySend,
  isLatest = true,
}: {
  turn: Turn;
  isStreaming: boolean;
  onFork?: () => void;
  forkLabel?: string;
  onRegenerate?: () => void;
  /** The turn ended in an error: the redo action reads as Retry. */
  failed?: boolean;
  /** The prompt never reached the agent; retrying resends it as-is. */
  onRetrySend?: () => void;
  isLatest?: boolean;
}) {
  const { t } = useI18n();
  const answer = turn.assistantText.trim();
  const canFork =
    Boolean(onFork) && turn.status === "complete" && answer.length > 0;
  const redo = onRetrySend ?? onRegenerate;
  const canRegenerate =
    Boolean(redo) &&
    !isStreaming &&
    turn.promptText.trim().length > 0;
  // ↻ only exists to retry a failure; the caller decides when that applies.
  const redoLabel = failed ? t("common.retry") : t("chat.regenerate");
  const forkTitle = forkLabel ?? t("chat.continueInNewChat");
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
        className={cn(
          layer,
          isStreaming ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={isStreaming ? undefined : true}
      ></div>
      <div
        className={cn(
          layer,
          // Left, with the transcript's own text. The answer's own actions do not
          // belong on the prompt's side of the column.
          "justify-start gap-1",
          isStreaming
            ? "pointer-events-none opacity-0"
            : isLatest
              ? "opacity-100"
              // Older turns: reveal on hover of the turn, like the prompt row.
              : "pointer-events-none opacity-0 group-hover/turn:pointer-events-auto group-hover/turn:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
        )}
        aria-hidden={isStreaming ? true : undefined}
      >
        <TurnMetaActions timestamp={endedAt} copyText={answer} align="start">
          {canRegenerate && (
            <button
              type="button"
              data-turn-regenerate-action="true"
              {...(onRetrySend ? { "data-user-echo-retry": "true" } : {})}
              aria-label={redoLabel}
              title={redoLabel}
              onClick={redo}
              className={TURN_ACTION_BUTTON}
            >
              <RotateCcwIcon className={TURN_ACTION_ICON} aria-hidden="true" />
            </button>
          )}
          {canFork && (
            <button
              type="button"
              data-turn-fork-action="true"
              data-fork-kind={forkLabel ? "message" : "session"}
              aria-label={forkTitle}
              title={forkTitle}
              onClick={onFork}
              className={TURN_ACTION_BUTTON}
            >
              <GitBranchIcon className={TURN_ACTION_ICON} aria-hidden="true" />
            </button>
          )}
        </TurnMetaActions>
      </div>
    </div>
  );
}
