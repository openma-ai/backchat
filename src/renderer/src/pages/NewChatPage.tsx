import { useEffect, useState, type CSSProperties } from "react";

import { Composer } from "@/components/chat/Composer";
import { ProjectChipRow } from "@/components/chat/ComposerProjectControls";
import {
  EmptyStateIntro,
  HomeSuggestionSelect,
} from "@/components/chat/HomeSuggestions";
import { CHAT_COMPOSER_FRAME_CLASS } from "@/lib/chat-layout";
import { useChatSessionActions } from "@/lib/chat-session-actions";
import { useChatSubmission } from "@/lib/chat-submission";
import { useHomeSuggestionState } from "@/lib/home-suggestion-state";
import { useI18n } from "@/lib/i18n";
import {
  selectActive,
  sessionStore,
  useSessionStore,
} from "@/lib/session-store";
import { useSettings } from "@/lib/settings-store";
import { useTheme } from "@/lib/theme";
import { resolveThemeText } from "@/lib/theme-plugin";
import { cn } from "@/lib/utils";
import { getThemePlugin } from "@/themes";
import { resolveComposerAgentBinding } from "@/components/chat/ChatView";

/** Dedicated cold-create page. It owns only the hero, suggestions, project
 * choice, and draft composer; transcript/runtime/rail chrome belongs to
 * ChatPage after the first submission promotes the draft. */
export function NewChatPage() {
  const { locale, t } = useI18n();
  const { themeId, effective } = useTheme();
  const settings = useSettings();
  const active = useSessionStore(selectActive);
  const draft = active?.status === "draft" ? active : undefined;
  const themePlugin = getThemePlugin(themeId, effective);
  const homeComposer = themePlugin.presentation?.homeComposer;
  const homeComposerPlaceholder = resolveThemeText(
    homeComposer?.placeholder,
    locale,
    t("chat.askAnything"),
  );
  const [pickedCwd, setPickedCwd] = useState<string | null>(null);
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);

  // Root navigation always owns one in-memory draft. Creating it is local and
  // synchronous; no ACP process starts until Composer submits the first turn.
  useEffect(() => {
    if (draft) return;
    sessionStore.newDraft();
  }, [draft]);

  useEffect(() => {
    setPickedCwd(draft?.chosenCwd ?? null);
    setPickedAgentId(null);
  }, [draft?.chosenCwd, draft?.id]);

  const {
    draft: suggestionDraft,
    selection,
    selectedPrompt,
    phase,
    back,
    consumeDraft,
    fillPrefix,
    selectSuggestion,
    selectTemplate,
    syncForUserInput,
  } = useHomeSuggestionState(draft?.id);
  const onSubmit = useChatSubmission({
    isSide: false,
    pickedAgentId,
    pickedCwd,
    onSuggestionSubmitted: consumeDraft,
  });
  const {
    cancelActiveTurn,
    resolveAsk,
    setSessionConfigOption,
  } = useChatSessionActions({
    active: draft,
    isNativeSubagent: false,
    isSide: false,
  });
  const binding = resolveComposerAgentBinding(draft);
  const draftProjectCwd = pickedCwd || draft?.chosenCwd || "";
  const setDraftProjectCwd = (cwd: string | null) => {
    setPickedCwd(cwd);
    if (draft) sessionStore.setChosenCwd(draft.id, cwd);
  };

  return (
    <div
      className="new-chat-page home-empty-stage flex h-full min-h-0 flex-col"
      data-page="new-chat"
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
            selectedSuggestionKind={selection?.kind ?? null}
            onSelectSuggestion={selectSuggestion}
            onSuggestion={phase === "dismissed" ? undefined : fillPrefix}
          />
        </div>
      </div>
      <div
        data-chat-column="composer"
        className={cn(
          CHAT_COMPOSER_FRAME_CLASS,
          "home-composer-stack relative space-y-2",
        )}
        style={
          homeComposer?.width !== undefined
            ? {
                "--home-composer-frame-width": `${homeComposer.width}px`,
              } as CSSProperties
            : undefined
        }
      >
        {phase === "choosing" && selection && (
          <HomeSuggestionSelect
            selection={selection}
            selectedPrompt={selectedPrompt}
            onBack={back}
            onSuggestion={selectTemplate}
          />
        )}
        <Composer
          sessionId={draft?.id}
          sessionAgentId={binding.sessionAgentId}
          disabled={!draft}
          running={false}
          availableCommands={draft?.availableCommands}
          attachmentDefaultPath={draft?.cwd || pickedCwd || undefined}
          lockedAgentId={binding.lockedAgentId}
          pickedAgentId={pickedAgentId}
          suggestionDraft={suggestionDraft}
          currentModeId={draft?.currentModeId}
          onUserInput={syncForUserInput}
          onPickAgent={setPickedAgentId}
          configOptions={draft?.configOptions}
          onSetConfigOption={setSessionConfigOption}
          onResolveAsk={resolveAsk}
          placeholder={homeComposerPlaceholder}
          onSubmit={onSubmit}
          onCancel={cancelActiveTurn}
        />
        <ProjectChipRow
          isDraft={true}
          activeCwd={draftProjectCwd}
          onPickCwd={async () => {
            const next = await window.backchat.uiFsPickDir({
              defaultPath: draftProjectCwd || undefined,
            });
            if (next) setDraftProjectCwd(next);
          }}
          onSetCwd={setDraftProjectCwd}
          onClearCwd={() => setDraftProjectCwd(null)}
        />
      </div>
      <div className="home-corner-decoration" aria-hidden="true" />
    </div>
  );
}
