import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { bindComposerPrefill } from "@/lib/composer-prefill";
import { buildComposerSubmitText, canSubmitComposer, resolveComposerKeyAction } from "@/lib/composer-prompt";
import {
  HOST_PLAN_COMMAND,
  hostSessionStateAction,
  isHostForkSlashCommand,
  isSkillSlashCommand,
  pendingArgumentCommand,
  slashCommandConfigAction,
  withHostForkCommand,
} from "@/lib/composer-slash-commands";
import { promptAnnotationStore } from "@/lib/prompt-annotations";
import { useComposerContextState } from "@/lib/composer-context-state";
import { ComposerAnnotationStrip } from "./ComposerAnnotations";
import { ComposerSessionStateSlot, InlineComposerOptionControls, PermissionModeChip, SessionRunChip } from "./ComposerSessionControls";
import {
  armedCommandSessionStatePresentation,
  armedCommandStillPending,
  goalSessionStatePresentation,
  selectComposerSessionStatePresentation,
} from "@/lib/composer-session-state";
import {
  planModeExitAction,
  planModeSessionStatePresentation,
} from "@/lib/plan-mode-session-state";
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
/** Armed commands outlive their Composer instance. Submitting from a draft
 *  navigates to the new session, which remounts this component — component
 *  state would drop the chip exactly when the round trip needs it held. The
 *  draft entry is handed to whichever session mounts next. */
const armedCommandBySession = new Map<string, AcpAvailableCommand>();
const DRAFT_ARMED_HANDOFF = "draft:armed-handoff";

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
  const setText: typeof setTextState = (next) => {
    setTextState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      composerTextBySession.set(composerTextKey, resolved);
      return resolved;
    });
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
  // Inline skill token: the chip overlays the first text line and the
  // textarea indents its first line by the measured chip width.
  const skillChipRef = useRef<HTMLSpanElement>(null);
  const [skillIndent, setSkillIndent] = useState(0);
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
  const [armedCommand, setArmedCommandState] = useState<AcpAvailableCommand | null>(
    () => armedCommandBySession.get(composerTextKey)
      ?? armedCommandBySession.get(DRAFT_ARMED_HANDOFF)
      ?? null,
  );
  const setArmedCommand = (next: AcpAvailableCommand | null) => {
    if (next) armedCommandBySession.set(composerTextKey, next);
    else armedCommandBySession.delete(composerTextKey);
    armedCommandBySession.delete(DRAFT_ARMED_HANDOFF);
    setArmedCommandState(next);
  };
  const armedSentRef = useRef(false);
  // Editing a session state re-opens it here: the state is cleared by whoever
  // asked, and the composer receives the old text so the user changes a word
  // instead of retyping the whole objective.
  useEffect(() => {
    bindComposerPrefill((prefill) => {
      if ((prefill.sessionId ?? null) !== (sessionId ?? null)) return;
      setText(prefill.text);
      reportComposerContent(prefill.text);
      setArmedCommand(prefill.armCommand ?? null);
      requestAnimationFrame(() => taRef.current?.focus());
    });
    return () => bindComposerPrefill(null);
  });
  const armedObservedRunRef = useRef(false);
  const disarm = () => {
    armedSentRef.current = false;
    armedObservedRunRef.current = false;
    setArmedCommand(null);
  };
  // Hold the chip across the round trip. The state it is entering only arrives
  // with the agent's snapshot, so releasing at submit time left the composer
  // with no state for a beat.
  useEffect(() => {
    if (!armedCommand) return;
    if (armedSentRef.current && running) armedObservedRunRef.current = true;
    if (
      !armedCommandStillPending({
        sent: armedSentRef.current,
        observedRun: armedObservedRunRef.current,
        stateActive: !!goal,
        running: !!running,
      })
    ) {
      disarm();
    }
  }, [armedCommand, goal, running]);
  const composerSessionState = selectComposerSessionStatePresentation([
    {
      // An armed command outranks the states it is about to enter: it is the
      // thing the next Enter will do.
      priority: 5,
      presentation: armedCommand
        ? armedCommandSessionStatePresentation(armedCommand, {
          goal: t("chat.goalStatus"),
        })
        : undefined,
    },
    {
      priority: 10,
      presentation: planModeSessionStatePresentation(
        {
          agentId: currentAgentId,
          currentModeId,
          configOptions: effectiveConfigOptions,
          draftConfigValues,
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
  const planExit = planModeExitAction({
    configOptions: effectiveConfigOptions,
    availableCommands: composerAvailableCommands,
    draftConfigValues,
  });
  /** The chip's dismiss control. Each session state cancels through its own
   * transport: plan resets a config option (draft overrides included), goal
   * sends its control command the way ACP invokes commands. Plan reads the
   * live config catalogue rather than a static value, so it stays ahead of
   * the declared exit. */
  const sessionStateExit = (() => {
    if (!composerSessionState) return undefined;
    // Disarming is local: nothing was sent, so nothing has to be undone.
    if (composerSessionState.kind === "armed_command") {
      return disarm;
    }
    const applyConfig = (configId: string, value: string | boolean) => () => {
      if (lockedAgentId) {
        void onSetConfigOption?.(configId, value);
        return;
      }
      setDraftConfigValues((prev) => ({ ...prev, [configId]: value }));
    };
    if (composerSessionState.kind === "plan_mode") {
      return planExit ? applyConfig(planExit.configId, planExit.value) : undefined;
    }
    const exit = composerSessionState.exit;
    if (!exit) return undefined;
    if (exit.kind === "setConfigOption") return applyConfig(exit.configId, exit.value);
    // A control prompt needs a live session to reach.
    if (!sessionId || !hasHarnessSetup) return undefined;
    const sendPrompt = (text: string) => {
      onSubmit(
        text,
        undefined,
        primaryIntent,
        draftConfigValues,
        currentEnabledAgent?.id,
        [],
      );
    };
    if (exit.kind === "extensionMethod") {
      // Prefer the method the agent advertised: it leaves the state without
      // spending a turn. Runtimes without an extension channel reject the
      // call, so fall back to the transport the presentation declared.
      return () => {
        void window.backchat
          .sessionRequestExtension({
            session_id: sessionId,
            method: exit.method,
            ...(exit.params ? { params: exit.params } : {}),
          })
          .catch(() => {
            if (exit.fallback) sendPrompt(exit.fallback.text);
          });
      };
    }
    return () => sendPrompt(exit.text);
  })();
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
  useLayoutEffect(() => {
    if (!selectedSkillCommand) {
      setSkillIndent(0);
      return;
    }
    const measure = () => {
      const width = skillChipRef.current?.offsetWidth ?? 0;
      setSkillIndent(width > 0 ? width + 8 : 0);
    };
    measure();
    // Fonts and the chip's truncation settle a frame later.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [selectedSkillCommand]);
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

  /** Report composer content after a programmatic change. The textarea's own
   * onChange is the only other reporter, so clearing text in code (a session
   * state switch has nothing to send) would otherwise leave the home page
   * stuck in its dismissed phase with the suggestions gone. */
  const reportComposerContent = (nextText: string) => {
    onUserInput(
      nextText.trim().length > 0
      || !!selectedSkillCommand
      || attachments.length > 0
      || annotations.length > 0,
    );
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
    // Session-state commands (`/plan`) switch a config option locally.
    // The command text never becomes a prompt — there is nothing to send.
    // The host contract backstops a catalogue entry that lost its `_meta`.
    const configAction =
      slashCommandConfigAction(cmd) ?? hostSessionStateAction(cmd, currentAgentId);
    if (configAction) {
      if (lockedAgentId) {
        void onSetConfigOption?.(configAction.configId, configAction.value);
      } else {
        setDraftConfigValues((prev) => ({
          ...prev,
          [configAction.configId]: configAction.value,
        }));
      }
      setText("");
      reportComposerContent("");
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
    const bare = attachments.length === 0
      && annotations.length === 0
      && sessionReferences.length === 0;
    // A command whose argument is still missing arms the composer instead of
    // leaving as a prompt: Codex answers a bare `/goal` with an error turn.
    if (bare && !armedCommand) {
      const waiting = pendingArgumentCommand(t, composerAvailableCommands);
      if (waiting) {
        setArmedCommand(waiting);
        setText("");
        reportComposerContent("");
        clearDismissal();
        requestAnimationFrame(() => taRef.current?.focus());
        return;
      }
    }
    // A bare session-state command (`/plan`) is a config switch even when
    // the picker was dismissed or never opened — it must not leave the app
    // as a prompt.
    if (bare) {
      const stateCommand =
        composerAvailableCommands.find(
          (command) =>
            (slashCommandConfigAction(command)
              ?? hostSessionStateAction(command, currentAgentId))
            && `/${command.name}` === t.trim(),
        ) ??
        // The catalogue can lag behind a fast typist (agent list still
        // loading). The host contract for Codex holds regardless.
        (currentAgentId === "codex-acp" &&
        `/${HOST_PLAN_COMMAND.name}` === t.trim()
          ? HOST_PLAN_COMMAND
          : undefined);
      if (stateCommand) {
        pickCommand(stateCommand);
        return;
      }
    }
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
      armedCommand ? `/${armedCommand.name} ${t}` : t,
      attachments,
      intent,
      draftConfigValues,
      currentEnabledAgent?.id,
      annotations,
      sessionReferences,
    );
    rememberCurrentRun();
    if (armedCommand) {
      armedSentRef.current = true;
      // A draft submit lands on a new session id, so leave the chip where the
      // next mount will find it.
      if (!sessionId) armedCommandBySession.set(DRAFT_ARMED_HANDOFF, armedCommand);
    }
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
  /** The run-action slot shows a stop only when there is nothing to send:
   *  a draft always keeps its send/queue meaning so Enter and the button
   *  never disagree. */
  const stopIsPrimary = !!running && !canSubmitNow;

  return (
    <div
      className="composer-stack-card relative w-full"
    >
      <div
        data-suggestion-fill-active={suggestionFillActive ? "true" : undefined}
        className={cn(
        // Match the rails with an opaque surface. A restrained input shadow
        // supplies depth without backdrop compositing or inset highlights.
        "composer-control-row-inset composer-radius relative flex flex-col gap-[var(--composer-section-gap)] py-[var(--composer-card-padding-block)] app-composer-surface composer-card",
          "transition-shadow",
          suggestionFillActive && "composer-suggestion-fill suggestion-fill-active",
        )}
      >
      {pendingAsk && onResolveAsk ? (
        <ComposerBrokerAsk ask={pendingAsk} onResolve={onResolveAsk} />
      ) : (
      <>
      <div className="flex min-h-[var(--composer-body-min-height)] w-full flex-col items-start gap-1.5 px-1">
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
            className="flex min-h-[var(--composer-body-min-height)] w-full flex-wrap items-start gap-1.5"
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
            <div
              className={cn(
                "relative flex min-w-0",
                sessionReferences.length > 0 || mentionedFileAttachmentIds.size > 0
                  ? "min-w-[12rem] flex-[1_1_12rem]"
                  : "w-full",
              )}
            >
              {/* The skill token reads as part of the prompt: it occupies the
                  start of the first text line and the caret continues right
                  after it. text-indent only offsets the first line, so
                  wrapped lines reclaim the full width. */}
              {selectedSkillCommand && (
                <span
                  ref={skillChipRef}
                  className="absolute left-0 top-0 z-[1] flex h-7 max-w-[60%] items-center"
                >
                  <SkillCommandChip
                    command={selectedSkillCommand}
                    onRemove={() => {
                      clearSelectedSkill();
                      requestAnimationFrame(() => taRef.current?.focus());
                    }}
                  />
                </span>
              )}
              <textarea
              ref={taRef}
              value={text}
              onChange={(e) => {
              const nextText = e.target.value;
              const nextCaret = e.target.selectionStart ?? nextText.length;
              cancelSuggestionFill();
              reportComposerContent(nextText);
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
              style={{ textIndent: skillIndent ? `${skillIndent}px` : undefined }}
              className={cn(
                selectedSkillCommand
                  ? "min-h-[var(--control-height-compact)]"
                  : "min-h-[var(--composer-body-min-height)]",
                "w-full max-h-[240px] resize-none bg-transparent text-sm leading-7 text-fg outline-none",
                "placeholder:text-fg-subtle",
                "[field-sizing:content]",
              )}
            />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          <button
            type="button"
            aria-label={t("chat.attachFiles")}
            title={t("chat.attachFiles")}
            onClick={() => void pickAttachments()}
            disabled={!!disabled}
            className={cn(
              "inline-flex size-[var(--control-height-compact)] shrink-0 items-center justify-center rounded-md",
              "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg",
              "disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40",
              "transition-colors",
            )}
          >
            <PlusIcon className="size-[var(--composer-attachment-icon-size)]" />
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
          <ComposerSessionStateSlot
            presentation={composerSessionState}
            onClear={sessionStateExit}
            clearLabel={
              composerSessionState?.kind === "goal"
                ? t("chat.exitGoal")
                : t("chat.exitPlanMode")
            }
          />
          <InlineComposerOptionControls
            // Session config options are changeable "at any point during a
            // session, whether the Agent is idle or generating a response"
            // (ACP v1 session-config-options). Gating them on `running` is
            // what made 代我批准 look present but refuse to switch mid-turn —
            // exactly when you need to loosen approvals.
            disabled={false}
            configOptions={effectiveConfigOptions}
            onSetConfigOption={(configId, value) => {
              if (lockedAgentId) return onSetConfigOption?.(configId, value);
              setDraftConfigValues((prev) => ({ ...prev, [configId]: value }));
            }}
          />
        </div>

        <div
          className="flex shrink-0 items-center gap-0.5"
          data-composer-run-actions="true"
        >
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

          {/* One slot, one interaction weight: the glyph follows what Enter
              would do right now. With a draft it sends or queues; with an
              empty composer mid-run it stops the turn. Two adjacent buttons
              forced a choice between an enabled stop and a disabled send. */}
          <button
            type="button"
            onClick={() => {
              if (stopIsPrimary) {
                onCancel();
                return;
              }
              submitComposer(primaryIntent);
            }}
            disabled={!stopIsPrimary && !canSubmitNow}
            data-composer-submit={stopIsPrimary ? undefined : "true"}
            data-composer-stop={stopIsPrimary ? "true" : undefined}
            aria-label={
              stopIsPrimary
                ? t("chat.stop")
                : running
                  ? primaryRunningAction?.ariaLabel
                  : t("chat.send")
            }
            title={
              stopIsPrimary
                ? t("chat.stop")
                : running
                  ? primaryRunningAction?.title
                  : t("chat.send")
            }
            className={cn(
              "inline-flex h-7 shrink-0 items-center justify-center rounded-md px-1.5",
              "text-fg-subtle hover:text-fg hover:bg-[var(--control-bg-hover)]",
              "disabled:text-fg-subtle/40 disabled:hover:bg-transparent disabled:hover:text-fg-subtle/40",
              "transition-colors",
            )}
          >
            {stopIsPrimary ? (
              <SquareIcon className="size-3.5" />
            ) : (
              <CornerDownLeftIcon className="size-4" />
            )}
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
