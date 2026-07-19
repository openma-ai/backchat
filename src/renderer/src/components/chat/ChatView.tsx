import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BugIcon, SendIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { StatusNotice } from "@/components/ui/status-notice";
import { cn } from "@/lib/utils";
import {
  selectActive,
  selectSideActive,
  selectTurnsFor,
  sessionStore,
  useSessionStore,
} from "@/lib/session-store";
import { useSettings } from "@/lib/settings-store";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { resolveThemeText } from "@/lib/theme-plugin";
import { getThemePlugin } from "@/themes";
import { ConversationTimeline } from "./ConversationTimeline";
import {
  CHAT_COMPOSER_FRAME_CLASS,
  CHAT_TURN_FRAME_CLASS,
} from "@/lib/chat-layout";
import { ResponseAnnotationController } from "./ResponseAnnotations";
import { ProjectChipRow } from "./ComposerProjectControls";
import { MarkdownCwdProvider } from "./ChatMarkdown";
import { TurnBlock } from "./ChatTurn";
import {
  EmptyStateIntro,
  HomeSuggestionSelect,
} from "./HomeSuggestions";
import { useChatSubmission } from "@/lib/chat-submission";
import { useHomeSuggestionState } from "@/lib/home-suggestion-state";
import { useChatSessionActions } from "@/lib/chat-session-actions";
import { Composer } from "./Composer";
import { ComposerNotice } from "./ComposerNotice";

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
export function ChatView({ mode = "main" }: { mode?: "main" | "side" } = {}) {
  const { locale, t } = useI18n();
  const { themeId, effective } = useTheme();
  const themePlugin = getThemePlugin(themeId, effective);
  const homeComposer = themePlugin.presentation?.homeComposer;
  const homeComposerPlaceholder = resolveThemeText(
    homeComposer?.placeholder,
    locale,
    t("chat.askAnything"),
  );
  const isSide = mode === "side";
  const activeSelector = isSide ? selectSideActive : selectActive;
  const active = useSessionStore(activeSelector);
  const turnsSelector = useMemo(
    () =>
      active
        ? selectTurnsFor(active.id)
        : () => [] as ReturnType<ReturnType<typeof selectTurnsFor>>,
    [active?.id],
  );
  const turns = useSessionStore(turnsSelector);
  const settings = useSettings();
  const navigate = useNavigate();
  const isNativeSubagent = active?.sideKind === "subagent";
  const transcriptRef = useRef<HTMLDivElement>(null);

  // The chip keeps a local value for the bare home route, while explicit
  // drafts also persist the choice on SessionRow. The draft's projectScope
  // is authoritative at submit time, so stale local state cannot move a
  // global New chat into the previously active project.
  const [pickedCwd, setPickedCwd] = useState<string | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
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

  const onSubmit = useChatSubmission({
    isSide,
    pickedAgentId,
    pickedCwd,
    onSuggestionSubmitted: consumeSuggestionDraft,
  });
  const {
    askInSideChat,
    cancelActiveTurn,
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
  const queuedTurnCount = active?.queuedTurnIds?.length ?? 0;
  const boundComposerAgentId =
    active && active.status !== "draft" ? active.agent_id : undefined;
  const composer = (
    <Composer
      sessionId={active?.id}
      sessionAgentId={boundComposerAgentId}
      disabled={
        isNativeSubagent ||
        (active?.status === "starting" && !!active?.agent_id) ||
        active?.status === "errored"
      }
      running={!isNativeSubagent && (active?.status === "running" || hasActiveTurn)}
      availableCommands={active?.availableCommands}
      attachmentDefaultPath={active?.cwd || pickedCwd || undefined}
      lockedAgentId={active && active.status !== "draft" ? active.agent_id : null}
      pickedAgentId={pickedAgentId}
      suggestionDraft={suggestionDraft}
      onUserInput={syncHomeSuggestionsForUserInput}
      onPickAgent={setPickedAgentId}
      configOptions={active?.configOptions}
      onSetConfigOption={setSessionConfigOption}
      placeholder={
        isNativeSubagent
          ? "Native subagent is managed by its parent"
          : !active || active.status === "draft"
          ? homeComposerPlaceholder
          : active.status === "starting"
            ? t("chat.starting")
            : active.status === "errored"
              ? t("chat.sessionErrored")
              : active.status === "running" || hasActiveTurn
                ? queuedTurnCount > 0
                  ? `${queuedTurnCount} queued…`
                  : t("chat.addToQueue")
                : t("chat.reply")
      }
      onSubmit={onSubmit}
      onCancel={cancelActiveTurn}
    />
  );
  const composerNotice =
    active?.status === "errored" ? (
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
        if (next) setDraftProjectCwd(next);
      }}
      onSetCwd={(p) => setDraftProjectCwd(p)}
      onClearCwd={() => setDraftProjectCwd(null)}
    />
  ) : null;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-chat-surface={isSide ? "side" : "main"}
    >
      {isEmpty ? (
        // Keep the empty-state ideas in the flexible content region while the
        // composer uses the exact same bottom frame as an active conversation.
        // Starting a chat therefore changes the transcript, not the input's
        // position or width.
        <div
          className="home-empty-stage flex h-full min-h-0 flex-col"
          style={
            homeComposer?.width !== undefined
              ? {
                  "--home-composer-theme-width": `${homeComposer.width}px`,
                } as CSSProperties
              : undefined
          }
        >
          <div className="home-empty-content flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto px-4">
            <div className="home-empty-stack flex w-full max-w-[1120px] flex-col items-center gap-6">
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
            </div>
          </div>
          <div
            data-chat-column="composer"
            className={cn(
              CHAT_COMPOSER_FRAME_CLASS,
              "relative",
              "space-y-2 pb-4",
              "home-composer-stack",
            )}
            style={
              homeComposer?.width !== undefined
                ? {
                    "--home-composer-frame-width": `${homeComposer.width}px`,
                  } as CSSProperties
                : undefined
            }
          >
            {homeSuggestionPhase === "choosing" && homeSuggestionSelection && !isSide && (
              <HomeSuggestionSelect
                selection={homeSuggestionSelection}
                selectedPrompt={selectedSuggestionPrompt}
                onBack={backHomeSuggestion}
                onSuggestion={selectHomeSuggestionTemplate}
              />
            )}
            {chipRow}
            {composerNotice}
            {composer}
          </div>
          {!isSide && <div className="home-corner-decoration" aria-hidden="true" />}
        </div>
      ) : (
        // Conversation flow — turns scroll above a bottom-pinned composer.
        <>
          <Conversation key={active?.id ?? "none"} className="flex-1 min-h-0">
            <ConversationContent
              // ConversationContent is the inner scroller of
              // use-stick-to-bottom. Keep it full-width so the
              // scrollbar pill (drawn at the right edge of this
              // element) sits flush against the right edge of the
              // conversation, where the timeline strip and right
              // shell live. Horizontal breathing room belongs to the
              // turn frame below, which is inset to the composer's
              // rounded-corner safe line rather than the outer card edge.
              className={cn(
                "w-full px-0 py-6",
                "flex min-h-full flex-col",
              )}
            >
              <MarkdownCwdProvider cwd={active?.cwd}>
                <div
                  ref={transcriptRef}
                  className={CHAT_TURN_FRAME_CLASS}
                  data-chat-column="turns"
                >
                  {turns.map((turn) => <TurnBlock key={turn.id} turn={turn} />)}
                </div>
                <ResponseAnnotationController
                  scopeRef={transcriptRef}
                  destinationSessionId={active!.id}
                  onAskInSideChat={askInSideChat}
                />
              </MarkdownCwdProvider>
            </ConversationContent>
            <ConversationScrollButton />
            {!isSide && <ConversationTimeline turns={turns} />}
          </Conversation>
          <div
            data-chat-column="composer"
            className={cn(
              CHAT_COMPOSER_FRAME_CLASS,
              "space-y-2 pb-4",
            )}
          >
            {chipRow}
            {composerNotice}
            {composer}
          </div>
        </>
      )}

    </div>
  );
}

export { Composer };
