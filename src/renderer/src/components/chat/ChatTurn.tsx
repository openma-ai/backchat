import { turnStopNotice } from "@/lib/turn-stop-reason";
import { memo, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightFromLineIcon,
  AtSignIcon,
  CalendarClockIcon,
  CheckIcon,
  CopyIcon,
  ListChecksIcon,
  Loader2Icon,
  TargetIcon,
} from "lucide-react";
import { AgentUITurnView, projectAcpChatTurn } from "@openma/common/chat-ui";
import type {
  AgentUIMessageItem,
  AgentUIToolItem,
} from "@openma/common/agent-ui";
import { StatusNotice } from "@/components/ui/status-notice";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { reduceTurn, type TurnRender } from "@/lib/reduce-turn";
import {
  capitalizeToolLabel,
  pickToolActivityTarget,
  settleInterruptedToolStatus,
  toolActivityVerbKey,
  toolRunSummaryKeys,
} from "@/lib/chat-tool-presentation";
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
  ASSISTANT_MARKDOWN_CLASS,
  StreamdownText,
  useMarkdownCwd,
} from "./ChatMarkdown";
import { PlanDocumentActivity } from "./PlanDocumentActivity";
import { TurnScheduleCards } from "./ScheduledTaskMessageBar";
import {
  parseScheduledTaskPrompt,
  type ScheduledTaskPromptSurface,
} from "@/lib/scheduled-task-presentation";
import { inspectRawTurnEvents, RawEventInspector } from "./RawEventInspector";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { projectThoughtEvent, ThoughtEventRow } from "./ThoughtEventRow";
import { ToolRow } from "./ToolPresentation";
import { BACKCHAT_COLLAPSIBLE_PRIMITIVES } from "@/components/ai-elements/reasoning";

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
    const settled =
      turn.status === "running"
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
        (item) => item.kind !== "tool" || item.toolCallId !== sourceToolCallId,
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
            hasSessionReferences || scheduledPrompt
              ? ""
              : (commandInvocation?.body ?? turn.promptText),
          attachments: turn.attachments,
          events: turn.events,
          assistantText: turn.assistantText,
          status: turn.status,
          errorMessage: turn.errorMessage,
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
      turn.attachments,
      turn.endedAt,
      turn.errorMessage,
      turn.events,
      turn.id,
      turn.promptText,
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

  return (
    <AgentUITurnView
      sessionId={turn.sessionId}
      turn={projectedTurn}
      frameStatus={turn.status}
      thoughts="history"
      activityTools="all"
      collapsiblePrimitives={BACKCHAT_COLLAPSIBLE_PRIMITIVES}
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
            {hasSessionReferences && <ReferencedSessionPrompt turn={turn} />}
            {scheduledPrompt && !hasSessionReferences && (
              <ScheduledTaskUserPrompt turn={turn} surface={scheduledPrompt} />
            )}
          </>
        ),
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
        projectThoughtActivity: ({ item, live, prefixSkip }) =>
          projectThoughtEvent({
            turnId: turn.id,
            text: item.text,
            live,
            prefixSkip,
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
        renderError: ({ message }) => (
          <StatusNotice tone="danger">{message ?? "Turn failed."}</StatusNotice>
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
          <TurnFooter turn={turn} isStreaming={isStreaming} onFork={onFork} />
        ),
      }}
    />
  );
});

type Translate = ReturnType<typeof useI18n>["t"];

function projectedToolPresentation(tool: AgentUIToolItem) {
  return {
    kind: tool.toolKind,
    status: tool.status,
    title: tool.title,
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

function ScheduledTaskUserPrompt({
  turn,
  surface,
}: {
  turn: Turn;
  surface: ScheduledTaskPromptSurface;
}) {
  return (
    <div
      className="group is-user mb-2 ml-auto flex w-full max-w-[95%] flex-col items-end gap-2"
      data-session-turn-prompt="true"
      data-scheduled-task-prompt="true"
    >
      <div className="is-user:dark ml-auto flex w-fit min-w-0 max-w-full flex-col gap-1.5 overflow-hidden rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <CalendarClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{surface.name}</span>
        </p>
        {surface.prompt.length > 0 && (
          <p className="whitespace-pre-wrap">{surface.prompt}</p>
        )}
      </div>
      <div
        data-session-turn-prompt-meta="true"
        className="flex min-h-6 items-center justify-end gap-1"
      >
        <TurnMetaActions
          timestamp={turn.startedAt}
          copyText={surface.prompt}
          align="end"
        />
      </div>
    </div>
  );
}

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
  const canFork =
    Boolean(onFork) && turn.status === "complete" && answer.length > 0;
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
