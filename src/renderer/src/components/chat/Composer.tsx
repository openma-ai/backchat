import { useEffect, useRef, useState } from "react";
import { CornerDownLeftIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { PromptAnnotation, PromptAttachment } from "@shared/session-events.js";
import type { AgentMessageIntent } from "@shared/agent-interaction.js";
import type { AcpSessionConfigOption } from "@/lib/session-config-options";
import type { AcpAvailableCommand } from "@/lib/session-store";
import { useI18n } from "@/lib/i18n";
import { removeSuggestionTemplateSlot, type ComposerSuggestionDraft } from "@/lib/home-suggestion-flow";
import { AgentIcon } from "@/components/AgentIcon";
import { cn } from "@/lib/utils";
import { describeRunningMessageAction } from "@/lib/composer-delivery";
import { buildComposerSubmitText, canSubmitComposer, resolveComposerKeyAction } from "@/lib/composer-prompt";
import { isSkillSlashCommand } from "@/lib/composer-slash-commands";
import { promptAnnotationStore } from "@/lib/prompt-annotations";
import { useComposerContextState } from "@/lib/composer-context-state";
import { ComposerAnnotationStrip } from "./ComposerAnnotations";
import { InlineComposerOptionControls, PermissionModeChip, PlanSessionState, SessionRunChip } from "./ComposerSessionControls";
import { AttachmentPreviewStrip, SkillCommandChip, SuggestionTemplateEditor } from "./ComposerContentParts";
import { ComposerSlashCommandMenu } from "./ComposerSlashCommandMenu";
import { useComposerSuggestionState } from "@/lib/composer-suggestion-state";
import { useComposerHarnessState } from "@/lib/composer-harness-state";
import { useComposerSlashState } from "@/lib/composer-slash-state";

export function Composer({
  sessionId,
  sessionAgentId,
  agentPickerLabel,
  agentPickerAgentIds,
  disabled,
  running,
  placeholder,
  availableCommands,
  attachmentDefaultPath,
  lockedAgentId,
  pickedAgentId,
  suggestionDraft,
  onUserInput = () => undefined,
  configOptions,
  onPickAgent,
  onSetConfigOption,
  onSubmit,
  onCancel,
}: {
  sessionId?: string;
  sessionAgentId?: string;
  agentPickerLabel?: string;
  agentPickerAgentIds?: string[];
  disabled: boolean;
  running: boolean | undefined;
  placeholder: string;
  availableCommands?: AcpAvailableCommand[];
  attachmentDefaultPath?: string;
  lockedAgentId: string | null;
  pickedAgentId: string | null;
  suggestionDraft?: ComposerSuggestionDraft | null;
  onUserInput?: (hasContent: boolean) => void;
  configOptions?: AcpSessionConfigOption[];
  onPickAgent: (agentId: string) => void;
  onSetConfigOption?: (configId: string, value: string | boolean) => void | Promise<void>;
  onSubmit: (
    text: string,
    attachments?: PromptAttachment[],
    intent?: AgentMessageIntent,
    configOverrides?: Record<string, string | boolean>,
    selectedAgentId?: string,
    annotations?: PromptAnnotation[],
  ) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const {
    annotations,
    attachments,
    browserScreenshotNames,
    clearAttachments,
    pickAttachments,
    removeAnnotation,
    removeAttachment,
    removeLastAnnotation,
    removeLastAttachment,
  } = useComposerContextState({
    sessionId,
    disabled,
    attachmentDefaultPath,
    textareaRef: taRef,
  });
  const navigate = useNavigate();
  const {
    enabledAgents,
    agentLocked,
    currentAgentId,
    currentAgent,
    currentEnabledAgent,
    hasHarnessSetup,
    draftConfigValues,
    effectiveAvailableCommands,
    effectiveConfigOptions,
    primaryIntent,
    primaryRunningAction,
    rememberCurrentRun,
    resetDraftConfigValues,
    setDraftConfigValues,
  } = useComposerHarnessState({
    sessionAgentId,
    lockedAgentId,
    pickedAgentId,
    agentPickerLabel,
    configOptions,
    availableCommands,
    running,
  });
  const {
    clearDismissal,
    clearSelectedSkill,
    dismissPicker,
    movePicker,
    pickerIndex,
    selectedSkillCommand,
    selectSkillCommand,
    setDismissedSlashText,
    setPickerIndex,
    showPicker,
    slashCommandSections,
    visibleSlashCommands,
  } = useComposerSlashState({
    text,
    availableCommands: effectiveAvailableCommands,
  });
  const {
    suggestionFillActive,
    suggestionTemplate,
    setSuggestionTemplate,
    suggestionSlotValue,
    setSuggestionSlotValue,
    suggestionSlotInputRef,
    cancelSuggestionFill,
  } = useComposerSuggestionState({
    suggestionDraft,
    textareaRef: taRef,
    setText,
    setDismissedSlashText,
  });
  const staticAgentIds = agentPickerAgentIds?.filter(Boolean) ?? [];
  const visibleStaticAgentIds = staticAgentIds.slice(0, 3);

  const pickAgent = (id: string) => {
    resetDraftConfigValues();
    onPickAgent(id);
  };

  const notifyNoHarnessSetup = () => {
    toast.error("No harness setup", {
      description: "Open Settings to install and enable an ACP agent first.",
      action: {
        label: "Open Settings",
        onClick: () => void navigate({ to: "/settings/agents" }),
      },
    });
  };

  useEffect(() => {
    if (!disabled) taRef.current?.focus();
  }, [disabled]);

  const insertCommand = (cmd: AcpAvailableCommand) => {
    // Replace whatever `/foo` token the user was typing with `/name `
    // (trailing space) so the next keystroke goes into the argument.
    // If the command takes no argument, the trailing space is harmless
    // — agents trim it.
    setText(`/${cmd.name} `);
    clearDismissal();
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const pickCommand = (cmd: AcpAvailableCommand) => {
    if (isSkillSlashCommand(cmd)) {
      selectSkillCommand(cmd);
      setText("");
      clearDismissal();
      requestAnimationFrame(() => taRef.current?.focus());
      return;
    }
    if (cmd.input) {
      insertCommand(cmd);
      return;
    }
    const commandText = `/${cmd.name}`;
    if (!hasHarnessSetup) {
      notifyNoHarnessSetup();
      return;
    }
    if (!canSubmitComposer({
      text: commandText,
      disabled: !!disabled,
      running,
      actionDisabled: primaryRunningAction?.disabled || !hasHarnessSetup,
    })) return;
    onSubmit(
      commandText,
      undefined,
      primaryIntent,
      draftConfigValues,
      currentEnabledAgent?.id,
      annotations,
    );
    rememberCurrentRun();
    if (sessionId) promptAnnotationStore.clear(sessionId);
    setText("");
    clearDismissal();
  };

  const removeTemplateField = () => {
    if (!suggestionTemplate) return;
    const replacement = removeSuggestionTemplateSlot(
      suggestionTemplate,
      suggestionSlotValue,
    );
    setSuggestionTemplate(null);
    setSuggestionSlotValue("");
    setText(replacement.text);
    requestAnimationFrame(() => {
      const textarea = taRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(replacement.caret, replacement.caret);
    });
  };

  const submitText = buildComposerSubmitText({
    text,
    selectedSkillCommand,
    suggestionTemplate,
    suggestionSlotValue,
  });

  const submitComposer = (intent: AgentMessageIntent = primaryIntent) => {
    const t = submitText;
    const hasContent =
      t.trim().length > 0 || attachments.length > 0 || annotations.length > 0;
    if (hasContent && !hasHarnessSetup) {
      notifyNoHarnessSetup();
      return;
    }
    const action = running
      ? describeRunningMessageAction({
          agentId: currentAgentId,
          intent,
        })
      : null;
    if (!canSubmitComposer({
      text: t,
      attachments,
      annotations,
      disabled: !!disabled,
      running,
      actionDisabled: action?.disabled || !hasHarnessSetup,
    })) return;
    onSubmit(
      t,
      attachments,
      intent,
      draftConfigValues,
      currentEnabledAgent?.id,
      annotations,
    );
    rememberCurrentRun();
    setText("");
    setSuggestionTemplate(null);
    setSuggestionSlotValue("");
    clearAttachments();
    clearSelectedSkill();
    clearDismissal();
    if (sessionId) promptAnnotationStore.clear(sessionId);
  };

  const canSubmitNow = canSubmitComposer({
    text: submitText,
    attachments,
    annotations,
    disabled: !!disabled,
    running,
    actionDisabled: primaryRunningAction?.disabled || !hasHarnessSetup,
  });

  return (
    <div
      data-suggestion-fill-active={suggestionFillActive ? "true" : undefined}
      className={cn(
        // Liquid-glass material — matches sidebar / side-chat rail /
        // side-chat composer. Three of the four floating cards in this
        // shell are liquid-glass; making the main composer match keeps
        // the chrome coherent. (The bottom terminal panel is the one
        // exception — it's a plain white card because xterm-addon-webgl
        // can't render onto a transparent backdrop. See AppShell.tsx
        // comment on that panel for the full rationale.)
        //
        // `composer-card` overrides .liquid-glass's 16/40 px far drop
        // shadow — that shadow lands on the stage gap between this
        // composer and the bottom terminal panel and reads as a
        // visible horizontal band (image #12). Inset rims (the glass
        // tells) are preserved.
        "relative flex flex-col gap-2 rounded-2xl px-3 py-3 liquid-glass composer-card",
        "transition-shadow",
        suggestionFillActive && "composer-suggestion-fill suggestion-fill-active",
      )}
    >
      <div className="flex min-h-[60px] w-full flex-col items-start gap-2 px-1">
        {selectedSkillCommand && (
          <SkillCommandChip
            command={selectedSkillCommand}
            onRemove={() => {
              clearSelectedSkill();
              requestAnimationFrame(() => taRef.current?.focus());
            }}
          />
        )}
        {attachments.length > 0 && (
          <AttachmentPreviewStrip
            attachments={attachments}
            browserScreenshotNames={browserScreenshotNames}
            onRemove={removeAttachment}
          />
        )}
        {annotations.length > 0 && (
          <ComposerAnnotationStrip
            annotations={annotations}
            attachments={attachments}
            onRemove={removeAnnotation}
          />
        )}
        {suggestionTemplate ? (
          <SuggestionTemplateEditor
            inputRef={suggestionSlotInputRef}
            template={suggestionTemplate}
            value={suggestionSlotValue}
            disabled={!!disabled}
            onChange={(value) => {
              onUserInput(true);
              setSuggestionSlotValue(value);
            }}
            onRemove={removeTemplateField}
            onSubmit={() => submitComposer()}
          />
        ) : (
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              const nextText = e.target.value;
              cancelSuggestionFill();
              onUserInput(nextText.trim().length > 0
                || !!selectedSkillCommand
                || attachments.length > 0
              || annotations.length > 0);
              setText(nextText);
              clearDismissal();
            }}
            onKeyDown={(e) => {
              const highlightedSlashCommand =
                visibleSlashCommands[pickerIndex];
              const action = resolveComposerKeyAction({
                key: e.key,
                text,
                hasSelectedSkill: !!selectedSkillCommand,
                attachmentCount: attachments.length,
                annotationCount: annotations.length,
                slashPickerOpen: showPicker,
                hasSlashSelection: !!highlightedSlashCommand,
                shiftKey: e.shiftKey,
                isComposing: e.nativeEvent.isComposing,
              });

              switch (action) {
                case "remove-skill":
                  e.preventDefault();
                  clearSelectedSkill();
                  return;
                case "remove-attachment":
                  e.preventDefault();
                  removeLastAttachment();
                  return;
                case "remove-annotation":
                  e.preventDefault();
                  removeLastAnnotation();
                  return;
                case "slash-next":
                  e.preventDefault();
                  movePicker("next");
                  return;
                case "slash-previous":
                  e.preventDefault();
                  movePicker("previous");
                  return;
                case "slash-pick":
                  e.preventDefault();
                  pickCommand(highlightedSlashCommand!);
                  return;
                case "slash-dismiss":
                  e.preventDefault();
                  dismissPicker();
                  return;
                case "submit":
                  e.preventDefault();
                  submitComposer();
                  return;
                default:
                  return;
              }
            }}
            placeholder={selectedSkillCommand ? t("chat.addInstructions") : placeholder}
            disabled={!!disabled}
            rows={1}
            className={cn(
              // Bigger min-h so the empty composer has presence (Codex / Claude
              // Desktop both run ~3 lines of breathing in the textarea row).
              selectedSkillCommand ? "min-h-[28px]" : "min-h-[60px]",
              "max-h-[240px] w-full resize-none bg-transparent text-sm leading-7 text-fg outline-none",
              "placeholder:text-fg-subtle",
              "[field-sizing:content]",
            )}
          />
        )}
      </div>

      {/* Slash command picker — floats above the composer's top edge.
          Only renders when the textarea contents are a `/`-prefixed
          token and the agent has declared `availableCommands` via ACP.
          Keyboard nav is wired into the textarea's onKeyDown above; this
          surface is mouse-only fallback. */}
      {showPicker && (
        <ComposerSlashCommandMenu
          sections={slashCommandSections}
          selectedIndex={pickerIndex}
          onHighlight={setPickerIndex}
          onPick={pickCommand}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <button
            type="button"
            aria-label={t("chat.attachFiles")}
            title={t("chat.attachFiles")}
            onClick={() => void pickAttachments()}
            disabled={!!disabled}
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
              "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
              "disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40",
              "transition-colors",
            )}
          >
            <PlusIcon className="size-4" />
          </button>
          <PermissionModeChip
            disabled={!!running}
            agentId={currentAgentId}
            configOptions={effectiveConfigOptions}
            onSetConfigOption={(configId, value) => {
              if (lockedAgentId) return onSetConfigOption?.(configId, value);
              setDraftConfigValues((prev) => ({ ...prev, [configId]: value }));
            }}
          />
          <PlanSessionState configOptions={effectiveConfigOptions} />
          <InlineComposerOptionControls
            disabled={!!running}
            configOptions={effectiveConfigOptions}
            onSetConfigOption={(configId, value) => {
              if (lockedAgentId) return onSetConfigOption?.(configId, value);
              setDraftConfigValues((prev) => ({ ...prev, [configId]: value }));
            }}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Agent picker — Radix DropdownMenu so the popover matches
              the app's chrome (not macOS-native blue-highlight system
              menu). Trigger shows the current agent label + chevron;
              menu lists detected agents with a check on the active one. */}
          {agentPickerLabel ? (
            <span
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted",
                "cursor-default select-none",
              )}
              aria-label={agentPickerLabel}
              title={agentPickerLabel}
            >
              {visibleStaticAgentIds.length > 0 && (
                <span className="flex items-center -space-x-1">
                  {visibleStaticAgentIds.map((agentId, index) => (
                    <span
                      key={`${agentId}-${index}`}
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-full bg-bg text-fg-muted ring-1 ring-border/80",
                        "shadow-[0_1px_1px_rgb(0_0_0/0.04)]",
                      )}
                    >
                      <AgentIcon
                        agentId={agentId}
                        className="size-3.5 text-fg-muted"
                      />
                    </span>
                  ))}
                  {staticAgentIds.length > visibleStaticAgentIds.length && (
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-bg text-[10px] font-medium text-fg-muted ring-1 ring-border/80">
                      +{staticAgentIds.length - visibleStaticAgentIds.length}
                    </span>
                  )}
                </span>
              )}
              <span>{agentPickerLabel}</span>
            </span>
          ) : (
            <SessionRunChip
              disabled={!!running}
              locked={!!lockedAgentId || agentLocked}
              agents={enabledAgents}
              currentAgentId={currentAgentId}
              currentAgentLabel={currentEnabledAgent?.label ?? currentAgent?.label}
              configOptions={effectiveConfigOptions}
              onPickAgent={pickAgent}
              onSetConfigOption={(configId, value) => {
                if (lockedAgentId) onSetConfigOption?.(configId, value);
                else setDraftConfigValues((prev) => ({ ...prev, [configId]: value }));
              }}
            />
          )}

          {running && (
            <button
              type="button"
              onClick={onCancel}
              aria-label={t("chat.stop")}
              title={t("chat.stop")}
              className={cn(
                "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2",
                "text-fg-subtle hover:text-fg hover:bg-bg-surface",
                "transition-colors",
              )}
            >
              <SquareIcon className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              submitComposer(primaryIntent);
            }}
            disabled={!canSubmitNow}
            aria-label={running ? primaryRunningAction?.ariaLabel : t("chat.send")}
            title={running ? primaryRunningAction?.title : t("chat.send")}
            className={cn(
              "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2",
              "text-fg-subtle hover:text-fg hover:bg-bg-surface",
              "disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40",
              "transition-colors",
            )}
          >
            <CornerDownLeftIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
