import { composerPasteRouter } from "@/lib/composer-paste-router";
import type { PromptAttachment } from "@shared/session-events";
import { useComposerContextState } from "@/lib/composer-context-state";
import {
  collectTransferFiles,
  shouldConsumePaste,
} from "@/lib/composer-transfer";
import { AttachmentPreviewStrip } from "./ComposerContentParts";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownLeftIcon, LoaderCircleIcon, PlusIcon } from "@/components/Icons";
import { AgentIcon } from "@/components/AgentIcon";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
import { resolveComposerKeyAction } from "@/lib/composer-prompt";
import { sessionStore, useSessionStore } from "@/lib/session-store";
import { composerAuthNeeded } from "@/lib/composer-harness-state";
import { reconnectAuthenticatedSession } from "@/lib/session-auth-recovery";
import { useI18n } from "@/lib/i18n";
import { StatusNotice } from "@/components/ui/status-notice";
import { ComposerAuthSetup } from "./ComposerAuthSetup";
import { ComposerAuthControls } from "./ComposerSessionControls";
import {
  ComposerAction,
  ComposerInput,
  ComposerSurface,
} from "./ComposerPrimitives";

/** Shared composer controls with durable project-inbox delivery. */
export function ProjectComposer({
  agentId,
  placeholder,
  busy,
  onSubmit,
  onEditAgents,
  role = "Coordinator",
  label = "Message coordinator",
  sessionId,
  localAuth = false,
  authRequired = false,
}: {
  agentId: string;
  role?: string;
  label?: string;
  placeholder: string;
  busy: boolean;
  onSubmit: (text: string, attachments: PromptAttachment[]) => Promise<boolean>;
  onEditAgents: () => void;
  sessionId?: string;
  localAuth?: boolean;
  authRequired?: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [authOpen, setAuthOpen] = useState(false);
  const session = useSessionStore(useMemo(() =>
    (store: typeof sessionStore) => sessionId ? store.get(sessionId) : undefined,
  [sessionId]));
  useEffect(() => {
    if (session?.authRequired || authRequired) setAuthOpen(true);
  }, [authRequired, session?.authRequired, sessionId]);
  const [text, setText] = useState("");
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const { data: agents } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    queryFn: () => window.backchat.agentsList(),
  });
  const contextId = useId();
  const context = useComposerContextState({
    sessionId: `project-composer:${contextId}`,
    disabled: busy,
    textareaRef: input,
  });
  const attachTransfer = (transfer: DataTransfer) => {
    const files = collectTransferFiles(transfer).files;
    if (!busy && files.length) void context.attachTransferFiles(files);
  };
  const transferRef = useRef(attachTransfer);
  transferRef.current = attachTransfer;
  const pasteRegistration = useRef<ReturnType<
    typeof composerPasteRouter.register
  > | null>(null);
  useEffect(() => {
    if (busy) return;
    const registration = composerPasteRouter.register((clipboard, event) => {
      if (!shouldConsumePaste(collectTransferFiles(clipboard as DataTransfer)))
        return;
      event.preventDefault();
      transferRef.current(clipboard as DataTransfer);
    });
    pasteRegistration.current = registration;
    if (document.activeElement === input.current) registration.noteFocus();
    return () => {
      registration.unregister();
      pasteRegistration.current = null;
    };
  }, [busy]);
  const agent = agents?.find((a) => a.id === agentId);
  const needsAuth = localAuth && composerAuthNeeded(agent, {
    authRequired: session?.authRequired || authRequired,
    auth: session?.auth,
  });
  const reconnect = useMutation({
    mutationFn: async () => {
      const next = await window.backchat.agentsList({ refresh: true });
      queryClient.setQueryData(AGENTS_QUERY_KEY, next);
      if (next.find(item => item.id === agentId)?.auth?.status === "configured")
        await reconnectAuthenticatedSession(sessionId);
    },
  });
  const send = async () => {
    if (
      (!text.trim() && !context.attachments.length) ||
      busy ||
      needsAuth ||
      reconnect.isPending ||
      sending.current
    )
      return;
    sending.current = true;
    const submitted = text;
    const attachments = context.attachments;
    setText("");
    try {
      if (await onSubmit(submitted.trim(), attachments)) {
        context.clearAttachments();
      } else {
        setText((current) => (current ? current : submitted));
      }
    } catch (error) {
      setText((current) => (current ? current : submitted));
      throw error;
    } finally {
      sending.current = false;
      input.current?.focus();
    }
  };
  return (
    <div className="flex shrink-0 flex-col gap-2">
      {localAuth ? <ComposerAuthSetup
        open={authOpen}
        sessionId={sessionId}
        sessionAgentId={agentId}
        authRequired={session?.authRequired || authRequired}
        sessionAuth={session?.auth}
        sessionSupportsLogout={!!session?.supportsLogout}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={() => reconnectAuthenticatedSession(sessionId)}
      /> : null}
      {reconnect.error ? <StatusNotice tone="danger" appearance="quiet">
        {reconnect.error instanceof Error ? reconnect.error.message : String(reconnect.error)}
      </StatusNotice> : needsAuth ? <StatusNotice tone="warning" appearance="quiet">
        {session?.auth?.message || session?.lastError || t("chat.signInToChat")}
      </StatusNotice> : null}
    <div
      className="composer-stack-card relative w-full"
      onDragOver={(e) => {
        if (!busy && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        if (!busy && collectTransferFiles(e.dataTransfer).files.length) {
          e.preventDefault();
          attachTransfer(e.dataTransfer);
        }
      }}
      onPaste={(e) => {
        if (!busy) {
          const collected = collectTransferFiles(e.clipboardData);
          if (shouldConsumePaste(collected)) e.preventDefault();
          if (collected.files.length) attachTransfer(e.clipboardData);
        }
      }}
    >
      <ComposerSurface>
        <AttachmentPreviewStrip
          attachments={context.attachments}
          browserScreenshotNames={new Set()}
          onRemove={context.removeAttachment}
        />
        <div className="flex min-h-[var(--composer-body-min-height)] w-full flex-col px-1">
          <ComposerInput
            ref={input}
            onFocus={() => pasteRegistration.current?.noteFocus()}
            aria-label={label}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              const action = resolveComposerKeyAction({
                key: e.key,
                text,
                hasSelectedSkill: false,
                attachmentCount: context.attachments.length,
                annotationCount: 0,
                slashPickerOpen: false,
                hasSlashSelection: false,
                shiftKey: e.shiftKey,
                isComposing: e.nativeEvent.isComposing,
              });
              if (action === "remove-attachment") {
                e.preventDefault();
                const last = context.attachments.at(-1);
                if (last) context.removeAttachment(last.id);
              }
              if (action === "submit") {
                e.preventDefault();
                void send();
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <ComposerAction
            aria-label={t("project.attachFiles")}
            title={t("project.attachFiles")}
            disabled={busy}
            onClick={() => void context.pickAttachments()}
          >
            <PlusIcon className="size-4" />
          </ComposerAction>
          <button
            type="button"
            onClick={onEditAgents}
            aria-label={t("project.editSettings")}
            className="mr-auto inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg"
          >
            <AgentIcon agentId={agentId} />
            <span className="truncate">{agent?.label ?? agentId}</span>
            <span className="text-fg-subtle">· {role}</span>
          </button>
          <ComposerAuthControls
            authNeeded={needsAuth}
            refreshing={reconnect.isPending}
            onSignIn={() => setAuthOpen(true)}
            onRefresh={() => reconnect.mutate()}
          />
          <ComposerAction
            aria-label={t("project.sendMessage")}
            title={t("project.sendMessage")}
            data-composer-submit="true"
            disabled={busy || needsAuth || reconnect.isPending || (!text.trim() && !context.attachments.length)}
            onClick={() => void send()}
          >
            {busy ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <CornerDownLeftIcon className="size-4" />
            )}
          </ComposerAction>
        </div>
      </ComposerSurface>
    </div>
    </div>
  );
}
