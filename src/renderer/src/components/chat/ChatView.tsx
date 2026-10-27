import { SessionMessages } from "./SessionMessages";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { BugIcon, SendIcon } from "@/components/Icons";
import { useNavigate } from "@tanstack/react-router";
import { AgentChatView } from "@openma/common/chat-ui";
import type { AgentUITurnState } from "@openma/common/agent-ui";
import { GoalEditDialog } from "./GoalEditDialog";
import { toast } from "sonner";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { CHAT_SCROLL_BUTTON_CIRCLE_CLASS } from "@/components/ai-elements/conversation";
import { Badge } from "@/components/ui/badge";
import { StatusNotice } from "@/components/ui/status-notice";
import { environmentErrorKind } from "@/lib/environment-error";
import { cn } from "@/lib/utils";
import {
  ConversationErrorBoundary,
  ConversationErrorFallback,
  ConversationSurfaceLoader,
} from "./ConversationLoadingState";
import {
  useSessionFirstScreenPaint,
  useSessionSearchJump,
} from "./useChatTranscriptLifecycle";
import {
  selectActive,
  selectOpenMAEventsFor,
  selectSideActive,
  selectTurnsFor,
  selectWorkItemsFor,
  sessionStore,
  useSessionStore,
} from "@/lib/session-store";
import type { SessionRow, Turn } from "@/lib/session-store";
import { useSettings } from "@/lib/settings-store";
import { useI18n } from "@/lib/i18n";
import { goalProgressPresentation } from "@/lib/goal-progress";
import { composerProgressCallbacksForSessionCapabilities } from "@/lib/composer-progress-adapters";
import { composerActivityModulesForSession } from "@/lib/composer-activity-dock";
import { useTheme } from "@/lib/theme";
import { resolveThemeText } from "@/lib/theme-plugin";
import { getThemePlugin } from "@/themes";
import { ConversationTimeline } from "./ConversationTimeline";
import { HistoryPager } from "./HistoryPager";
import { FollowOnSend } from "./FollowOnSend";
import { ResponseAnnotationController } from "./ResponseAnnotations";
import { ProjectChipRow } from "./ComposerProjectControls";
import { MarkdownCwdProvider } from "./ChatMarkdown";
import { TurnBlock } from "./ChatTurn";
import {
  EmptyStateIntro,
  HomeSuggestionSelect,
} from "./HomeSuggestions";
import { retryBoundChatSend, retryFailedChatSend, useChatSubmission, type ChatDelivery } from "@/lib/chat-submission";
import { openHistoryWindow } from "@/lib/history-paging";
import {
  insertOptimisticEcho,
  mergeOptimisticEchoes,
  persistedClientIds,
  reconcileOptimisticEchoes,
  type OptimisticUserEcho,
} from "@/lib/optimistic-user-echo";
import { forkPointsByTurn } from "@/lib/fork-point";
import {
  messageForkEnabled,
  wholeSessionForkEnabled,
} from "@/lib/fork-support";
import { useHomeSuggestionState } from "@/lib/home-suggestion-state";
import { useChatSessionActions } from "@/lib/chat-session-actions";
import { Composer } from "./Composer";
import { ComposerAuthSetup } from "./ComposerAuthSetup";
import { reconnectAuthenticatedSession } from "@/lib/session-auth-recovery";
import { ComposerNotice } from "./ComposerNotice";
import { ComposerProgress } from "./ComposerProgress";
import { SessionRuntimeSummary } from "./SessionRuntimeSummary";
import { CursorCloudBinding } from "./CursorCloudBinding";

export {
  buildSlashCommandSections,
  normalizeAgentAvailableCommands,
} from "@/lib/composer-slash-commands";
export { canSubmitComposer } from "@/lib/composer-prompt";
export { MarkdownCwdProvider } from "./ChatMarkdown";
export { shouldShowTransientThought } from "@/lib/turn-presentation";
export { TurnBlock } from "./ChatTurn";
export { HOME_SUGGESTIONS } from "./HomeSuggestions";
export {
  removeSuggestionTemplateSlot,
  serializeSuggestionTemplate,
  transitionHomeSuggestionPhase,
} from "@/lib/home-suggestion-flow";
export type {
  ComposerSuggestionDraft,
  HomeSuggestionEvent,
  HomeSuggestionPhase,
} from "@/lib/home-suggestion-flow";

/** Pending prompts already have a single visual home in ComposerProgress.
 * Keep them out of the transcript until the main process promotes one to an
 * active turn, otherwise the same user message appears twice. */
export function filterQueuedTurns<T extends { status: string }>(
  turns: readonly T[],
): T[] {
  return turns.filter((turn) => turn.status !== "queued");
}

export function resolveAgentChatPhase(
  active: Pick<SessionRow, "status"> | null | undefined,
): "missing" | "draft" | "active" {
  if (!active) return "missing";
  return active.status === "draft" ? "draft" : "active";
}

function projectChatSurfaceTurns(
  turns: readonly Turn[],
): AgentUITurnState[] {
  return turns.map((turn) => ({
    id: turn.id,
    status:
      turn.status === "complete"
        ? "completed"
        : turn.status === "error"
          ? "failed"
          : turn.status,
    items: [],
  }));
}

/** Provider queue depth is display-only; local queued prompts remain the
 * editable source. Reuse the existing placeholder count without hiding a
 * larger queue observed inside the harness. */
export function isSessionComposerDisabled(status: string | undefined): boolean {
  return status === "errored" || status === "disposed";
}

export function isPromptQueueEnabled(setting: boolean | undefined, supportsSteering: boolean | undefined): boolean {
  return setting !== false || supportsSteering !== true;
}

export function canSteerQueuedPrompts(
  session: Pick<SessionRow, "supportsSteering"> | null | undefined,
): boolean {
  return session?.supportsSteering === true;
}

export function resolveComposerAgentBinding(
  active: Pick<SessionRow, "status" | "kind" | "agent_id"> | null | undefined,
): { sessionAgentId: string | undefined; lockedAgentId: string | null } {
  const agentId = active?.agent_id.trim() || "";
  // A GUI side draft keeps its inherited harness when promoted into a main
  // draft. `promoteSideToMain` intentionally preserves `agent_id`, so the
  // composer must keep honoring that binding until the first submission
  // starts the ACP session. Ordinary New chat drafts have an empty agent_id
  // and therefore remain freely selectable.
  const shouldBind = !!agentId;
  return {
    sessionAgentId: shouldBind ? agentId : undefined,
    lockedAgentId: shouldBind ? agentId : null,
  };
}

/**
 * ChatView — the right pane.
 *
 * Cold-create flow: if active.status === "draft", the composer's submit
 * promotes the draft (registers agent_id from settings, fires session.start
 * IPC), awaits the start request itself, then fires session.prompt. The
 * store independently reflects session.ready for rendering.
 *
 * Without an active session in scope (e.g. /chat/$id with an unknown id),
 * the page shows a "start a chat" hint. The user clicks "+ New chat" in the
 * sidebar to get back to a real session.
 *
 * Dual-mode: when `mode === "side"` the view reads from the store's
 * sideActive pointer instead of the main active, cold-creates side
 * drafts (kind: "side"), and does not navigate on submit (side
 * sessions don't have URLs — the rail owns their lifecycle).
 */
/** Coordinator-only facts. The chat shell, composer, and turn pipeline stay ChatView's. */
export interface CoordinatorChatBinding {
  projectId: string;
  runId?: string;
  sessionId: string;
  agentId: string;
  cwd: string;
  label: string;
  placeholder: string;
  inputLabel: string;
  loadHistory: boolean;
  deliver: (input: ChatDelivery) => Promise<void>;
}

export function ChatView({
  mode = "main",
  binding,
}: {
  mode?: "main" | "side";
  binding?: CoordinatorChatBinding;
} = {}) {
  const { locale, t } = useI18n();
  const { themeId, effective } = useTheme();
  const themePlugin = getThemePlugin(themeId, effective);
  const homeComposer = themePlugin.presentation?.homeComposer;
  const homeComposerPlaceholder = resolveThemeText(
    homeComposer?.placeholder,
    locale,
    t("chat.askAnything"),
  );
  const isSide = mode === "side" && !binding;
  const boundSessionId = binding?.sessionId;
  const activeSelector = useMemo(() => {
    if (boundSessionId) {
      return (store: typeof sessionStore) => store.get(boundSessionId);
    }
    return isSide ? selectSideActive : selectActive;
  }, [boundSessionId, isSide]);
  const active = useSessionStore(activeSelector);
  const [boundLoadError, setBoundLoadError] = useState<string | null>(null);
  const loadBoundSessionHistory = useCallback(() => {
    if (!binding) return;
    setBoundLoadError(null);
    sessionStore.ensureBoundSession({
      id: binding.sessionId,
      agentId: binding.agentId,
      cwd: binding.cwd,
      label: binding.label,
      projectId: binding.projectId,
    });
    if (binding.loadHistory) {
      void openHistoryWindow(binding.sessionId).catch((error: unknown) => {
        setBoundLoadError(
          error instanceof Error ? error.message : "Couldn't load history",
        );
      });
    }
  }, [
    binding?.sessionId,
    binding?.agentId,
    binding?.cwd,
    binding?.label,
    binding?.projectId,
    binding?.loadHistory,
  ]);
  useEffect(() => {
    loadBoundSessionHistory();
  }, [loadBoundSessionHistory]);
  const turnsSelector = useMemo(
    () =>
      active
        ? selectTurnsFor(active.id)
        : () => [] as ReturnType<ReturnType<typeof selectTurnsFor>>,
    [active?.id],
  );
  const turns = useSessionStore(turnsSelector);
  const workItemsSelector = useMemo(
    () => selectWorkItemsFor(active?.id),
    [active?.id],
  );
  const workItems = useSessionStore(workItemsSelector);
  const openmaEventsSelector = useMemo(
    () => selectOpenMAEventsFor(active?.id),
    [active?.id],
  );
  const openmaEvents = useSessionStore(openmaEventsSelector);
  const [echoes, setEchoes] = useState<readonly OptimisticUserEcho[]>([]);
  const visibleEchoes = useMemo(
    () => reconcileOptimisticEchoes(echoes, persistedClientIds(turns)),
    [echoes, turns],
  );
  const echoedTurns = useMemo(
    () => mergeOptimisticEchoes(turns, visibleEchoes, active?.id),
    [active?.id, turns, visibleEchoes],
  );
  const transcriptTurns = useMemo(
    () => filterQueuedTurns(echoedTurns),
    [echoedTurns],
  );
  const historyPendingSelector = useMemo(
    () => (s: typeof sessionStore) => (active?.id ? s.isHistoryPending(active.id) : false),
    [active?.id],
  );
  const historyPending = useSessionStore(historyPendingSelector);
  const chatSurfaceTurns = useMemo(
    () => projectChatSurfaceTurns(echoedTurns),
    [echoedTurns],
  );
  const turnsById = useMemo(
    () => new Map(echoedTurns.map((turn) => [turn.id, turn] as const)),
    [echoedTurns],
  );
  const settings = useSettings();
  const navigate = useNavigate();
  const isNativeSubagent = active?.sideKind === "subagent";
  const transcriptRef = useRef<HTMLDivElement>(null);
  const persistedSessionId = active && active.status !== "draft" ? active.id : null;
  const loadingFirstScreen = useSessionFirstScreenPaint({
    persistedSessionId,
    historyPending,
    transcriptRef,
  });

  const canForkCurrentSession = !isSide
    && active?.status !== "draft"
    && wholeSessionForkEnabled(active?.forkSupport)
    && !!active?.acp_session_id;
  const canForkFromMessage = canForkCurrentSession
    && messageForkEnabled(active?.forkSupport);
  const messageForkPoints = useMemo(
    () => forkPointsByTurn(transcriptTurns),
    [transcriptTurns],
  );
  const continueInNewChat = useCallback(() => {
    if (!active || !canForkCurrentSession) return;
    const forkId = sessionStore.newMainForkDraft(active.id);
    if (!forkId) return;
    void navigate({ to: "/" });
  }, [active, canForkCurrentSession, navigate]);
  const forkFromTurn = useCallback(
    (turnId: string) => {
      if (!active || !canForkFromMessage) return;
      const point = messageForkPoints.get(turnId);
      if (!point) return;
      const forkId = sessionStore.newMainForkDraft(active.id, point);
      if (!forkId) return;
      void navigate({ to: "/" });
    },
    [active, canForkFromMessage, messageForkPoints, navigate],
  );
  const latestForkableTurnId = canForkCurrentSession && !active?.activeTurnId
    ? [...transcriptTurns].reverse().find((turn) => turn.status === "complete")?.id
    : undefined;

  // The chip keeps a local value for the bare home route, while explicit
  // drafts also persist the choice on SessionRow. The draft's projectScope
  // is authoritative at submit time, so stale local state cannot move a
  // global New chat into the previously active project.
  const [pickedCwd, setPickedCwd] = useState<string | null>(null);
  const [goalEdit, setGoalEdit] = useState<string | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
  const [authSetupOpen, setAuthSetupOpen] = useState(false);
  const {
    draft: suggestionDraft,
    selection: homeSuggestionSelection,
    selectedPrompt: selectedSuggestionPrompt,
    phase: homeSuggestionPhase,
    back: backHomeSuggestion,
    consumeDraft: consumeSuggestionDraft,
    fillPrefix: fillSuggestionPrefix,
    selectSuggestion: selectHomeSuggestion,
    selectTemplate: selectHomeSuggestionTemplate,
    syncForUserInput: syncHomeSuggestionsForUserInput,
  } = useHomeSuggestionState(active?.id);
  // Re-baseline when the user navigates to a different session — picking
  // a workspace in session A shouldn't leak into draft B.
  useEffect(() => {
    setPickedCwd(
      active?.status === "draft" ? active.chosenCwd ?? null : null,
    );
    setPickedAgentId(null);
  }, [active?.chosenCwd, active?.id, active?.status]);
  useEffect(() => {
    setAuthSetupOpen(!!active?.authRequired);
  }, [active?.id]);
  useEffect(() => {
    if (active?.authRequired) setAuthSetupOpen(true);
  }, [active?.authRequired]);

  const onSubmit = useChatSubmission({
    isSide,
    pickedAgentId: binding ? binding.agentId : pickedAgentId,
    pickedCwd,
    onSuggestionSubmitted: consumeSuggestionDraft,
    boundSessionId: binding?.sessionId,
    deliver: binding?.deliver,
    onOptimisticEcho: (echo) => {
      setEchoes((current) => insertOptimisticEcho(current, echo));
    },
  });
  const retrySend = useCallback(
    (turn: Turn) => {
      if (turn.id.startsWith("echo:") && turn.clientId) {
        setEchoes((current) =>
          current.filter((echo) => echo.clientId !== turn.clientId),
        );
        void onSubmit(turn.promptText, turn.attachments ?? []);
        return;
      }
      if (binding?.deliver) {
        void retryBoundChatSend(turn, binding.deliver);
        return;
      }
      void retryFailedChatSend(turn);
    },
    [binding?.deliver, onSubmit],
  );
  const regenerateTurn = useCallback(
    (turn: Turn) => {
      const prompt = turn.promptText.trim();
      if (!prompt) return;
      void onSubmit(prompt, turn.attachments ?? []);
    },
    [onSubmit],
  );
  const editTurnPrompt = useCallback(
    (turn: Turn, nextPromptText: string) => {
      const trimmed = nextPromptText.trim();
      if (!trimmed) return;
      void onSubmit(trimmed, turn.attachments ?? []);
    },
    [onSubmit],
  );
  useSessionSearchJump({
    sessionId: active?.id,
    loadingFirstScreen,
    transcriptTurns,
    transcriptRef,
  });
  useEffect(() => {
    if (visibleEchoes !== echoes) setEchoes(visibleEchoes);
  }, [echoes, visibleEchoes]);
  const {
    askInSideChat,
    cancelActiveTurn,
    resolveAsk,
    setSessionConfigOption,
  } = useChatSessionActions({
    active,
    isNativeSubagent,
    isSide,
  });

  const isEmpty = !active || active.status === "draft" || turns.length === 0;
  // Composer is locked the moment a turn registers (activeTurnId set in
  // the store) and stays locked until the turn completes / errors /
  // cancels. Without this, the gap between submit and the first
  // session.event arriving lets the user fire a second prompt and
  // collapse the conversation order.
  const hasActiveTurn = !!active?.activeTurnId;
  const promptQueueEnabled = isPromptQueueEnabled(
    settings?.default.prompt_queue_enabled, active?.supportsSteering,
  );
  const queuedPrompts = active?.queuedPrompts ?? [];
  const showPromptQueue = promptQueueEnabled || queuedPrompts.length > 0;
  // The rows themselves, so the count and the list cannot disagree about what is
  // waiting. It used to be `Math.max(hostQueueDepth, providerQueueDepth)`, which
  // mixed the prompts this host holds with a depth the agent reports for a queue
  // of its own, and announced "1 queued…" above no rows at all.
  const queuedTurnCount = queuedPrompts.length;

  const composerAgentBinding = resolveComposerAgentBinding(active);
  const composer = (
    <Composer
      sessionId={active?.id}
      sessionAgentId={composerAgentBinding.sessionAgentId}
      disabled={
        isNativeSubagent ||
        (active?.status === "starting" && !!active?.agent_id) ||
        isSessionComposerDisabled(active?.status)
      }
      running={!isNativeSubagent && (active?.status === "running" || hasActiveTurn)}
      availableCommands={active?.availableCommands}
      attachmentDefaultPath={active?.cwd || pickedCwd || undefined}
      lockedAgentId={composerAgentBinding.lockedAgentId}
      pickedAgentId={pickedAgentId}
      sessionAuthRequired={!!active?.authRequired}
      sessionAuth={active?.auth}
      sessionSupportsLogout={!!active?.supportsLogout}
      suggestionDraft={suggestionDraft}
      goal={active?.goal}
      pendingAsk={active?.pendingAsks?.[0]}
      currentModeId={active?.currentModeId}
      promptQueueEnabled={promptQueueEnabled}
      onUserInput={syncHomeSuggestionsForUserInput}
      onPickAgent={setPickedAgentId}
      configOptions={active?.configOptions}
      onSetConfigOption={setSessionConfigOption}
      onResolveAsk={resolveAsk}
      inputLabel={binding?.inputLabel}
      placeholder={
        binding?.placeholder ?? (
        isNativeSubagent
          ? t("chat.nativeSubagentManaged")
          : !active || active.status === "draft"
          ? homeComposerPlaceholder
          : active.status === "starting"
            ? t("chat.starting")
            : active.status === "errored"
              ? t("chat.sessionErrored")
              : active.status === "running" || hasActiveTurn
              ? queuedTurnCount > 0
                  ? t("chat.queuedCount", { count: queuedTurnCount })
                  : !promptQueueEnabled && active?.supportsSteering
                    ? t("chat.steer")
                    : t("chat.addToQueue")
                : isEmpty
                  ? homeComposerPlaceholder
                : t("chat.reply")
        )
      }
      onSubmit={onSubmit}
      onCancel={cancelActiveTurn}
      canFork={canForkCurrentSession}
      onFork={continueInNewChat}
      onRequestAuth={() => setAuthSetupOpen(true)}
    />
  );
  // An error from the machine (e.g. a full disk) will fail the next send too,
  // so it stands above the composer; the turn itself only keeps a quiet line.
  const lastTurn = turns[turns.length - 1];
  const environmentError = environmentErrorKind(
    lastTurn?.sendState === "failed"
      ? (lastTurn.sendError ?? lastTurn.errorMessage)
      : lastTurn?.status === "error"
        ? lastTurn.errorMessage
        : active?.status === "errored"
          ? active.lastError
          : undefined,
  );
  // The composer notice already carries the last turn's failure (session
  // errored or environment error); the turn must not say it a second time.
  const composerShowsTurnError = !active?.authRequired
    && (environmentError === "diskFull" || active?.status === "errored")
    && (lastTurn?.status === "error" || lastTurn?.sendState === "failed");
  const composerNotice =
    active?.authRequired ? null : environmentError === "diskFull" ? (
      <StatusNotice tone="danger" appearance="quiet" data-composer-environment-error="diskFull">
        {t("chat.diskFull")}
      </StatusNotice>
    ) : active?.status === "errored" ? (
      <StatusNotice tone="danger" appearance="quiet">
        {active.lastError ?? t("chat.sessionErrored")}
      </StatusNotice>
    ) : active?.notice ? (
      <ComposerNotice
        notice={active.notice}
        dismissLabel={t("chat.dismissNotice")}
        onDismiss={() => sessionStore.dismissNotice(active.id, active.notice?.id)}
      />
    ) : null;
  const composerAuthSetup = (
    <ComposerAuthSetup
      open={authSetupOpen}
      sessionId={active?.id}
      sessionAgentId={composerAgentBinding.sessionAgentId}
      pickedAgentId={pickedAgentId}
      authRequired={!!active?.authRequired}
      sessionAuth={active?.auth}
      sessionSupportsLogout={!!active?.supportsLogout}
      onClose={() => setAuthSetupOpen(false)}
      onAuthenticated={() => reconnectAuthenticatedSession(active?.id)}
    />
  );
  const progressPresentation = active?.goal
    ? goalProgressPresentation(active.goal, {
        active: t("chat.goalActive"),
        paused: t("chat.goalPaused"),
        stalled: t("chat.goalStalled"),
        complete: t("chat.goalComplete"),
        blocked: t("chat.goalBlocked"),
        fallback: t("chat.goalStatus"),
      })
    : undefined;
  const progressCallbacks =
    active && progressPresentation
      ? composerProgressCallbacksForSessionCapabilities(
          {
            sessionId: active.id,
            activeTurnId: active.activeTurnId,
            progressKind: progressPresentation.kind,
            status: progressPresentation.status,
            objective: progressPresentation.title,
            availableCommands: active.availableCommands,
          },
          {
            cancelTurn: (input) => window.backchat.sessionCancel(input),
            editGoal: (input) => setGoalEdit(input.objective),
            runCommand: async (input) => {
              try {
                await window.backchat.sessionRunCommand(input);
              } catch (error) {
                toast.error("Could not update progress", {
                  description:
                    error instanceof Error ? error.message : String(error),
                });
                throw error;
              }
            },
          },
        )
      : undefined;
  const activityModules = useMemo(
    () => composerActivityModulesForSession({
      agentId: active?.agent_id,
      turns,
      projectTurn: sessionStore.projectTurn,
      workItems,
      openmaEvents,
      labels: {
        plan: t("chat.plan"),
        monitor: t("chat.monitor"),
        background: t("rightPanel.background"),
        elicitation: t("chat.externalInteraction"),
        elicitationComplete: t("chat.externalInteractionCompleted"),
        running: t("chat.activityRunning"),
        completed: t("chat.activityCompleted"),
        event: t("chat.activityEvent"),
        events: t("chat.activityEvents"),
      },
    }),
    [active?.agent_id, openmaEvents, sessionStore.projectTurn, t, turns, workItems],
  );
  const queueCallbacks =
    active && showPromptQueue
      ? {
          update: (turnId: string, text: string) =>
            window.backchat.sessionUpdatePromptQueue({
              session_id: active.id,
              action: "update",
              turn_id: turnId,
              text,
            }),
          remove: (turnId: string) =>
            window.backchat.sessionUpdatePromptQueue({
              session_id: active.id,
              action: "remove",
              turn_id: turnId,
            }),
          reorder: (turnIds: string[]) =>
            window.backchat.sessionUpdatePromptQueue({
              session_id: active.id,
              action: "reorder",
              turn_ids: turnIds,
            }),
          ...(canSteerQueuedPrompts(active)
            ? {
                steer: (turnId: string) =>
                  window.backchat.sessionUpdatePromptQueue({
                    session_id: active.id,
                    action: "steer",
                    turn_id: turnId,
                  }),
              }
            : {}),
        }
      : undefined;
  const composerProgress = (
    <>
    {goalEdit !== null && (
      <GoalEditDialog
        objective={goalEdit}
        open
        onOpenChange={(open) => { if (!open) setGoalEdit(null); }}
        onSave={(objective) => {
          // Sending the command is how ACP invokes it, and codex-acp's setGoal
          // replaces the objective outright — no clear needed first.
          void window.backchat.sessionRunCommand({
            session_id: active!.id,
            command: "goal",
            args: objective,
          });
        }}
      />
    )}
    <ComposerProgress
      presentation={progressPresentation}
      callbacks={progressCallbacks}
      activityModules={activityModules}
      queuedPrompts={queuedPrompts}
      queueCallbacks={queueCallbacks}
    />
    </>
  );
  // Project controls exist only while drafting. Once the session starts,
  // workspace ownership is locked and does not become ambient header chrome.
  const showChipRow = !active || active.status === "draft";
  const draftProjectCwd =
    pickedCwd ||
    (active?.status === "draft" ? active.chosenCwd : undefined) ||
    "";
  const setDraftProjectCwd = (cwd: string | null) => {
    setPickedCwd(cwd);
    if (active?.status === "draft") {
      sessionStore.setChosenCwd(active.id, cwd);
    }
  };
  const chipRow = showChipRow ? (
    <ProjectChipRow
      isDraft={true}
      activeCwd={draftProjectCwd}
      onPickCwd={async () => {
        const next = await window.backchat.uiFsPickDir({
          defaultPath: draftProjectCwd || undefined,
        });
        return next;
      }}
      onSetCwd={(p) => setDraftProjectCwd(p)}
      onClearCwd={() => setDraftProjectCwd(null)}
      projectId={active?.status === "draft" ? active.projectId : undefined}
      workspaceId={active?.status === "draft" ? active.workspaceId : undefined}
      onSetWorkspace={(workspaceId) => {
        if (active?.status === "draft") sessionStore.setDraftWorkspace(active.id, workspaceId);
      }}
    />
  ) : null;
  const runtimeFooter = active && active.status !== "draft" ? (
    <SessionRuntimeSummary session={active} queueDepth={queuedTurnCount} />
  ) : null;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      aria-busy={loadingFirstScreen}
      data-fork-support={active?.forkSupport?.level ?? "unknown"}
      data-chat-binding={binding ? "coordinator" : mode}
    >
      {loadingFirstScreen && (
        <ConversationSurfaceLoader
          overlay
          compact={isSide}
          label={t("chat.loadingHistory")}
        />
      )}
      {!loadingFirstScreen && boundLoadError && turns.length === 0 && (
        <ConversationErrorFallback
          overlay
          compact={isSide}
          message={boundLoadError}
          onRetry={loadBoundSessionHistory}
        />
      )}
      <ConversationErrorBoundary
        resetKey={active?.id ?? binding?.sessionId ?? null}
        compact={isSide}
      >
      <div className="flex h-full min-h-0 flex-1 flex-col"
        style={loadingFirstScreen ? { visibility: "hidden" } : undefined}
        inert={loadingFirstScreen}>
        <AgentChatView
          key={active?.id}
          sessionId={active?.id}
          surface={isSide ? "side" : "main"}
          phase={resolveAgentChatPhase(active)}
          turns={chatSurfaceTurns}
          transcriptRef={transcriptRef}
          homeStyle={
            homeComposer?.width !== undefined
              ? {
                  "--home-composer-theme-width": `${homeComposer.width}px`,
                } as CSSProperties
              : undefined
          }
          homeComposerStyle={
            homeComposer?.width !== undefined
              ? {
                  "--home-composer-frame-width": `${homeComposer.width}px`,
                } as CSSProperties
              : undefined
          }
          renderTurn={({ turn }) => {
            const sourceTurn = turnsById.get(turn.id);
            if (!sourceTurn) return null;
            const messagePoint = messageForkPoints.get(sourceTurn.id);
            // ↻ means "retry after a failure", and only for the latest
            // exchange. Editing the prompt is likewise last-turn only.
            const isLastTurn = sourceTurn.id === lastTurn?.id;
            const lastTurnFailed = isLastTurn
              && (sourceTurn.status === "error" || sourceTurn.sendState === "failed");
            const canRedoLast = isLastTurn && !isSide && !isNativeSubagent && !hasActiveTurn;
            const completedAnswer = sourceTurn.status === "complete"
              && sourceTurn.assistantText.trim().length > 0;
            // One button. Message fork wins on every completed reply,
            // including the last one. Session fork stays on the last reply.
            const forkFromMessage = !isSide
              && canForkFromMessage
              && completedAnswer
              && !!messagePoint;
            const forkWholeSession = !isSide
              && !canForkFromMessage
              && completedAnswer
              && sourceTurn.id === latestForkableTurnId;
            return (
              <TurnBlock
                turn={sourceTurn}
                hideErrorNotice={composerShowsTurnError && sourceTurn.id === lastTurn?.id}
                isLatest={isLastTurn}
                onRetrySend={isLastTurn ? retrySend : undefined}
                onForkTurn={forkFromMessage ? forkFromTurn : undefined}
                onFork={forkWholeSession ? continueInNewChat : undefined}
                forkLabel={forkFromMessage ? t("chat.forkFromHere") : undefined}
                onRegenerate={canRedoLast && lastTurnFailed ? regenerateTurn : undefined}
                onEditPrompt={canRedoLast ? editTurnPrompt : undefined}
              />
            );
          }}
          slots={{
            empty: (
              binding ? null : (
                <EmptyStateIntro
                  hasAgent={settings?.agents.some((agent) => agent.enabled) ?? false}
                  selectedSuggestionKind={homeSuggestionSelection?.kind ?? null}
                  onSelectSuggestion={selectHomeSuggestion}
                  onSuggestion={
                    isSide ||
                    isNativeSubagent ||
                    homeSuggestionPhase === "dismissed"
                      ? undefined
                      : (prompt) => {
                          fillSuggestionPrefix(prompt);
                        }
                  }
                />
              )
            ),
            homeBeforeComposer:
              binding ? null : homeSuggestionPhase === "choosing" &&
              homeSuggestionSelection &&
              !isSide ? (
                <HomeSuggestionSelect
                  selection={homeSuggestionSelection}
                  selectedPrompt={selectedSuggestionPrompt}
                  onBack={backHomeSuggestion}
                  onSuggestion={selectHomeSuggestionTemplate}
                />
              ) : null,
            beforeComposer: (
              <>
                {composerAuthSetup}
                {composerNotice}
                {composerProgress}
              </>
            ),
            composer,
            afterComposer: (
              <>
                {chipRow}
                <CursorCloudBinding session={active} />
                {runtimeFooter}
              </>
            ),
            wrapConversationContent: (children) => (
              <MarkdownCwdProvider cwd={active?.cwd}>
                {children}
              </MarkdownCwdProvider>
            ),
            conversationContentAfter: active ? (
              <>
              {/* Parent transcript uses per-turn subagent chips for quick
                  access. Child→parent session_messages must not float as
                  user bubbles after the main answer. Side-chat native
                  children still render directed session_message rows. */}
              {isNativeSubagent ? (
                <SessionMessages
                  messages={active.sessionMessages ?? []}
                  childAcpSessionId={active.acp_session_id || undefined}
                  hideTexts={transcriptTurns
                    .map((turn) => turn.assistantText.trim())
                    .filter(Boolean)}
                />
              ) : null}
              <ResponseAnnotationController
                scopeRef={transcriptRef}
                destinationSessionId={active.id}
                onAskInSideChat={askInSideChat}
              />
              </>
            ) : null,
            renderScrollButton: ({ onClick, className, icon }) => (
              <button
                type="button"
                aria-label={t("chat.scrollToBottom")}
                data-chat-scroll-to-bottom="true"
                onClick={onClick}
                className={cn(className, CHAT_SCROLL_BUTTON_CIRCLE_CLASS)}
              >
                {icon}
              </button>
            ),
            conversationOverlay:
              active || binding ? (
                <>
                  <HistoryPager sessionId={(binding?.sessionId ?? active?.id)!} />
                  <FollowOnSend tailTurnId={transcriptTurns.at(-1)?.id} />
                  {!isSide && <ConversationTimeline turns={transcriptTurns} />}
                </>
              ) : null,
            emptyAfter: !isSide && !binding ? (
              <div className="home-corner-decoration" aria-hidden="true" />
            ) : null,
          }}
        />
      </div>
      </ConversationErrorBoundary>
    </div>
  );
}

export { Composer };
