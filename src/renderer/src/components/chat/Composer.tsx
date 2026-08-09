---RESULT 1---
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeftIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type {
  PromptAnnotation,
  PromptAttachment,
  PromptSessionReference,
} from "@shared/session-events.js";
import type { ElicitationResponseInfo } from "@shared/api.js";
import type { AgentMessageIntent } from "@shared/agent-interaction.js";
import type { AcpSessionConfigOption } from "@/lib/session-config-options";
import type { SessionGoal } from "@/lib/session-types";
import {
  selectSessions,
  useSessionStore,
  type AcpAvailableCommand,
  type BrokerAsk,
} from "@/lib/session-store";
import { useI18n } from "@/lib/i18n";
import { removeSuggestionTemplateSlot, type ComposerSuggestionDraft } from "@/lib/home-suggestion-flow";
import { AgentIcon } from "@/components/AgentIcon";
import { cn } from "@/lib/utils";
import { describeRunningMessageAction } from "@/lib/composer-delivery";
import { buildComposerSubmitText, canSubmitComposer, resolveComposerKeyAction } from "@/lib/composer-prompt";
import {
  isHostForkSlashCommand,
  isSkillSlashCommand,
  withHostForkCommand,
} from "@/lib/composer-slash-commands";
import { promptAnnotationStore } from "@/lib/prompt-annotations";
import { useComposerContextState } from "@/lib/composer-context-state";
import { ComposerAnnotationStrip } from "./ComposerAnnotations";
import { ComposerSessionStateSlot, InlineComposerOptionControls, PermissionModeChip, SessionRunChip } from "./ComposerSessionControls";
import {
  goalSessionStatePresentation,
  selectComposerSessionStatePresentation,
} from "@/lib/composer-session-state";
import { planModeSessionStatePresentation } from "@/lib/plan-mode-session-state";
import {
  AttachmentPreviewStrip,
  MentionedFileStrip,
  SessionReferenceStrip,
  SkillCommandChip,
  SuggestionTemplateEditor,
} from "./ComposerContentParts";
import { ComposerSlashCommandMenu } from "./ComposerSlashCommandMenu";
import { useComposerSuggestionState } from "@/lib/composer-suggestion-state";
import { useComposerHarnessState } from "@/lib/composer-harness-state";
import { useComposerSlashState } from "@/lib/composer-slash-state";
import {
  filterSessionMentionCandidates,
  filterFileMentionCandidates,
  consumeSessionMention,
  createBrowseFileMentionCandidate,
  resolveSessionMention,
  type ComposerMentionCandidate,
  type FileMentionCandidate,
  type SessionMentionCandidate,
} from "@/lib/composer-mentions";
import { ComposerSessionMentionMenu } from "./ComposerSessionMentionMenu";
import { ComposerBrokerAsk } from "./ComposerAskPanel";

const composerTextBySession = new Map<string, string>();

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
  goal,
  pendingAsk,
  currentModeId,
  onUserInput = () => undefined,
  configOptions,
  onPickAgent,
  onSetConfigOption,
  onResolveAsk,
  canFork = false,
  onFork,
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
  goal?: SessionGoal;
  pendingAsk?: BrokerAsk;
  currentModeId?: string;
  onUserInput?: (hasContent: boolean) => void;
  configOptions?: AcpSessionConfigOption[];
  onPickAgent: (agentId: string) => void;
  onSetConfigOption?: (configId: string, value: string | boolean) => void | Promise<void>;
  onResolveAsk?: (
    optionId: string | null,
    approve?: boolean,
    elicitation?: ElicitationResponseInfo,
  ) => void | Promise<void>;
  canFork?: boolean;
  onFork?: () => void;
  onSubmit: (
    text: string,
    attachments?: PromptAttachment[],
    intent?: AgentMessageIntent,
    configOverrides?: Record<string, string | boolean>,
    selectedAgentId?: string,
    annotations?: PromptAnnotation[],
    sessionReferences?: PromptSessionReference[],
  ) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const composerTextKey = sessionId ?? "draft:pending";
  const [text, setTextState] = useState(
    () => composerTextBySession.get(composerTextKey) ?? "",
  );
  const setText = (next: string) => {
    composerTextBySession.set(composerTextKey, next);
    setTextState(next);
  };
  useEffect(() => {
    setTextState(composerTextBySession.get(composerTextKey) ?? "");
  }, [composerTextKey]);
  const [caret, setCaret] = useState(0);
  const [dismissedMentionText, setDismissedMentionText] = useState<string | null>(null);
  const [mentionPickerIndex, setMentionPickerIndex] = useState(0);
  const [fileMentionCandidates, setFileMentionCandidates] = useState<FileMentionCandidate[]>([]);
  const [mentionedFileAttachmentIds, setMentionedFileAttachmentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [sessionReferences, setSessionReferences] = useState<PromptSessionReference[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const persistedSessions = useSessionStore(selectSessions);
  const supportsSteering = sessionId
    ? persistedSessions.find((session) => session.id === sessionId)?.supportsSteering
    : false;
  const mentionCandidates = useMemo<SessionMentionCandidate[]>(
    () => persistedSessions.map((session) => ({
      id: session.id,
      label: session.label || session.id,
      agentId: session.agent_id,
    })),
    [persistedSessions],
  );
  const mentionMatch = useMemo(
    () => resolveSessionMention(text, caret),
    [caret, text],
  );
  useEffect(() => {
    if (!mentionMatch || dismissedMentionText === text || !attachmentDefaultPath) {
      setFileMentionCandidates([]);
      return;
    }
    let cancelled = false;
    void window.backchat.uiFsSearchFiles({
      path: attachmentDefaultPath,
      query: mentionMatch.query,
      limit: 8,
    }).then((files) => {
      if (cancelled) return;
      setFileMentionCandidates(files.map((attachment) => ({
        kind: "file" as const,
        id: attachment.id,
        label: attachment.name,
        path: attachment.path,
        attachment,
      })));
    }).catch(() => {
      if (!cancelled) setFileMentionCandidates([]);
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentDefaultPath, dismissedMentionText, mentionMatch?.end, mentionMatch?.query, mentionMatch?.start, text]);
  const visibleMentionCandidates = useMemo(
    (): ComposerMentionCandidate[] => mentionMatch && dismissedMentionText !== text
      ? [
          ...[
            ...filterSessionMentionCandidates(
              mentionCandidates,
              sessionId,
              mentionMatch.query,
            ).map((candidate) => ({ ...candidate, kind: "session" as const })),
            ...filterFileMentionCandidates(fileMentionCandidates, mentionMatch.query),
          ].slice(0, 7),
          createBrowseFileMentionCandidate(),
        ]
      : [],
    [dismissedMentionText, fileMentionCandidates, mentionCandidates, mentionMatch, sessionId, text],
  );
  const showMentionPicker = visibleMentionCandidates.length > 0;
  const {
    annotations,
    attachments,
    addAttachments,
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
    resetCurrentRunToDefaults,
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
    supportsSteering,
  });
  const composerAvailableCommands = useMemo(
    () => withHostForkCommand(
      effectiveAvailableCommands,
      canFork,
      {
        title: t("chat.continueInNewChat"),
        description: t("chat.continueInNewChatHint"),
      },
    ),
    [canFork, effectiveAvailableCommands, t],
  );
  const composerSessionState = selectComposerSessionStatePresentation([
    {
      priority: 10,
      presentation: planModeSessionStatePresentation(
        {
          agentId: currentAgentId,
          currentModeId,
          configOptions: effectiveConfigOptions,
        },
        {
          label: t("chat.plan"),
          title: t("chat.planActiveHint"),
        },
      ),
    },
    {
      priority: 20,
      presentation: goalSessionStatePresentation(
        goal,
        t("chat.goalStatus"),
      ),
    },
  ]);
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
    availableCommands: composerAvailableCommands,
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

  useEffect(() => {
    setCaret(0);
    setSessionReferences([]);
    setMentionedFileAttachmentIds(new Set());
    setDismissedMentionText(null);
    setMentionPickerIndex(0);
  }, [sessionId]);

  useEffect(() => {
    setMentionPickerIndex(0);
  }, [mentionMatch?.query, visibleMentionCandidates.length]);

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
    if (isHostForkSlashCommand(cmd)) {
      setText("");
      clearDismissal();
      onFork?.();
      return;
    }
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

  const pickMention = async (
    selected: ComposerMentionCandidate,
    currentCaret: number,
  ) => {
    if (selected.kind === "browse") {
      const files = await pickAttachments();
      if (files.length === 0) return;
      const inserted = consumeSessionMention(text, currentCaret);
      setText(inserted.text);
      setCaret(inserted.caret);
      setDismissedMentionText(null);
      setMentionedFileAttachmentIds((current) => new Set([
        ...current,
        ...files.map((file) => file.id),
      ]));
      onUserInput(true);
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.setSelectionRange(inserted.caret, inserted.caret);
      });
      return;
    }
    const inserted = consumeSessionMention(text, currentCaret);
    setText(inserted.text);
    setCaret(inserted.caret);
    setDismissedMentionText(null);
    if (selected.kind === "file") {
      setMentionedFileAttachmentIds((current) => new Set(current).add(selected.attachment.id));
      addAttachments([selected.attachment]);
    } else {
      setSessionReferences((current) =>
        current.some((reference) => reference.session_id === selected.id)
          ? current
          : [...current, { session_id: selected.id, title: selected.label }],
      );
    }
    onUserInput(true);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(inserted.caret, inserted.caret);
    });
  };

  const removeComposerAttachment = (attachmentId: string) => {
    setMentionedFileAttachmentIds((current) => {
      if (!current.has(attachmentId)) return current;
      const next = new Set(current);
      next.delete(attachmentId);
      return next;
    });
    removeAttachment(attachmentId);
  };

  const removeLastComposerAttachment = () => {
    const last = attachments.at(-1);
    if (last) {
      setMentionedFileAttachmentIds((current) => {
        if (!current.has(last.id)) return current;
        const next = new Set(current);
        next.delete(last.id);
        return next;
      });
    }
    removeLastAttachment();
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
      t.trim().length > 0 ||
      attachments.length > 0 ||
      annotations.length > 0 ||
      sessionReferences.length > 0;
    if (hasContent && !hasHarnessSetup) {
      notifyNoHarnessSetup();
      return;
    }
    const action = running
      ? describeRunningMessageAction({
          agentId: currentAgentId,
          intent,
          supportsSteering,
        })
      : null;
    if (!canSubmitComposer({
      text: t,
      attachments,
      annotations,
      sessionReferenceCount: sessionReferences.length,
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
      sessionReferences,
    );
    rememberCurrentRun();
    setText("");
    setSuggestionTemplate(null);
    setSuggestionSlotValue("");
    clearAttachments();
    setMentionedFileAttachmentIds(new Set());
    setSessionReferences([]);
    clearSelectedSkill();
    clearDismissal();
    if (sessionId) promptAnnotationStore.clear(sessionId);
  };

  const canSubmitNow = canSubmitComposer({
    text: submitText,
    attachments,
    annotations,
    sessionReferenceCount: sessionReferences.length,
    disabled: !!disabled,
    running,
    actionDisabled: primaryRunningAction?.disabled || !hasHarnessSetup,
  });

  return (
    <div
      className="composer-stack-card relative w-full"
    >
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
        "composer-radius relative flex flex-col gap-2 px-3 py-3 liquid-glass composer-card",
          "transition-shadow",
          suggestionFillActive && "composer-suggestion-fill suggestion-fill-active",
        )}
      >
      {pendingAsk && onResolveAsk ? (
        <ComposerBrokerAsk ask={pendingAsk} onResolve={onResolveAsk} />
      ) : (
      <>
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
            hiddenAttachmentIds={mentionedFileAttachmentIds}
            onRemove={removeComposerAttachment}
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
          <div
            data-slot="composer-inline-content"
            className="flex min-h-[60px] w-full flex-wrap items-start gap-1.5"
          >
            <SessionReferenceStrip
              references={sessionReferences}
              onOpen={(sessionIdToOpen) => {
                void navigate({
                  to: "/chat/$sessionId",
                  params: { sessionId: sessionIdToOpen },
                });
              }}
              onRemove={(sessionIdToRemove) => {
                setSessionReferences((current) =>
                  current.filter((reference) => reference.session_id !== sessionIdToRemove));
                requestAnimationFrame(() => taRef.current?.focus());
              }}
            />
            <MentionedFileStrip
              attachments={attachments.filter((attachment) => mentionedFileAttachmentIds.has(attachment.id))}
              onOpen={(attachment) => {
                void window.backchat.uiFsOpenPath({ path: attachment.path });
              }}
              onRemove={removeComposerAttachment}
            />
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => {
              const nextText = e.target.value;
              const nextCaret = e.target.selectionStart ?? nextText.length;
              cancelSuggestionFill();
              onUserInput(nextText.trim().length > 0
                || !!selectedSkillCommand
                || attachments.length > 0
              || annotations.length > 0);
                setText(nextText);
                setCaret(nextCaret);
                setDismissedMentionText(null);
                clearDismissal();
              }}
              onClick={(e) => setCaret(e.currentTarget.selectionStart ?? text.length)}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? text.length)}
              onKeyDown={(e) => {
              const currentCaret = e.currentTarget.selectionStart ?? text.length;
              const currentMention = resolveSessionMention(text, currentCaret);
              if (showMentionPicker && currentMention) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionPickerIndex((current) => {
                    const offset = e.key === "ArrowDown" ? 1 : -1;
                    const count = visibleMentionCandidates.length;
                    return count > 0 ? (current + offset + count) % count : 0;
                  });
                  return;
                }
                if (
                  (e.key === "Enter" || e.key === "Tab") &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  const selected = visibleMentionCandidates[mentionPickerIndex];
                  if (selected) {
                    e.preventDefault();
                    void pickMention(selected, currentCaret);
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissedMentionText(text);
                  return;
                }
              }
              const highlightedSlashCommand =
                visibleSlashCommands[pickerIndex];
              const action = resolveComposerKeyAction({
                key: e.key,
                text,
                hasSelectedSkill: !!selectedSkillCommand,
                attachmentCount: attachments.length,
                annotationCount: annotations.length,
                sessionReferenceCount: sessionReferences.length,
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
                  removeLastComposerAttachment();
                  return;
                case "remove-session-reference":
                  e.preventDefault();
                  setSessionReferences((current) => current.slice(0, -1));
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
                selectedSkillCommand ? "min-h-[28px]" : "min-h-[60px]",
                sessionReferences.length > 0 || mentionedFileAttachmentIds.size > 0
                  ? "min-w-[12rem] flex-[1_1_12rem]"
                  : "w-full",
                "max-h-[240px] resize-none bg-transparent text-sm leading-7 text-fg outline-none",
                "placeholder:text-fg-subtle",
                "[field-sizing:content]",
              )}
            />
          </div>
        )}
      </div>

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
          <ComposerSessionStateSlot presentation={composerSessionState} />
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
                        iconUrl={enabledAgents.find((agent) => agent.id === agentId)?.icon}
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
              onResetConfigOptions={
                lockedAgentId ? undefined : resetCurrentRunToDefaults
              }
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
            data-composer-submit="true"
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
      </>
      )}
      </div>

      {/* These transient surfaces are siblings of the composer card, not
          children of its padded content box. Their containing block is
          therefore the exact same width as the card, so the outer edges and
          material remain aligned at every viewport size. */}
      {showPicker && (
        <ComposerSlashCommandMenu
          sections={slashCommandSections}
          selectedIndex={pickerIndex}
          onHighlight={setPickerIndex}
          onPick={pickCommand}
        />
      )}
      {showMentionPicker && (
        <ComposerSessionMentionMenu
          candidates={visibleMentionCandidates}
          selectedIndex={mentionPickerIndex}
          onHighlight={setMentionPickerIndex}
          onPick={(selected) => {
            const currentCaret = taRef.current?.selectionStart ?? text.length;
            void pickMention(selected, currentCaret);
          }}
        />
      )}
    </div>
  );
}
