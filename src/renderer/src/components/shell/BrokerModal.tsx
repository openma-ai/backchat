/**
 * Global approval broker UI.
 *
 * Approval is out-of-band, blocking state owned by the main-process broker.
 * It must never be projected into the chat transcript. Incoming asks are
 * queued per session in SessionStore so a background task can still put its
 * approval dialog in front of the user.
 */

import { useCallback, useEffect, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAskDismissal } from "@/lib/composer-ask-decision";
import {
  selectSessions,
  sessionStore,
  useSessionStore,
  type BrokerAsk,
} from "@/lib/session-store";
import { getSettings } from "@/lib/settings-store";

function autoPickPermission(
  ask: Extract<BrokerAsk, { kind: "permission" }>["ask"],
  mode: "ask" | "auto" | "read_only",
): string | "modal" {
  if (mode === "ask") return "modal";
  const want = mode === "auto" ? "allow_once" : "reject_once";
  const exact = ask.options.find((option) => option.kind === want);
  if (exact) return exact.optionId;
  const prefix = mode === "auto" ? "allow_" : "reject_";
  return ask.options.find((option) => option.kind.startsWith(prefix))?.optionId ?? "modal";
}

export function BrokerModal() {
  const sessions = useSessionStore(selectSessions);
  const pending = useMemo(
    () =>
      sessions.flatMap((session) =>
        (session.pendingAsks ?? []).map((ask) => ({
          sessionId: session.id,
          ask,
        })),
      ),
    [sessions],
  );
  const current = pending[0];

  useEffect(() => {
    const offPermission = window.backchat.onPermissionRequest((ask) => {
      const mode = getSettings()?.default.permission_mode ?? "ask";
      const pick = autoPickPermission(ask, mode);
      if (pick !== "modal") {
        void window.backchat.permissionRespond(ask.requestId, pick);
        return;
      }
      sessionStore.enqueueAsk(ask.sessionId, { kind: "permission", ask });
    });
    const offWrite = window.backchat.onFsWriteApproval((ask) => {
      const mode = getSettings()?.default.permission_mode ?? "ask";
      if (mode === "auto") {
        void window.backchat.fsApprovalRespond(ask.requestId, true);
        return;
      }
      if (mode === "read_only") {
        void window.backchat.fsApprovalRespond(ask.requestId, false);
        return;
      }
      sessionStore.enqueueAsk(ask.sessionId, { kind: "fsWrite", ask });
    });
    void window.backchat.brokerPendingAsks().then((asks) => {
      for (const pending of asks) {
        sessionStore.enqueueAsk(pending.ask.sessionId, pending);
      }
    });
    return () => {
      offPermission();
      offWrite();
    };
  }, []);

  const resolve = useCallback(
    async (optionId: string | null, approve?: boolean) => {
      if (!current) return;
      const requestId = current.ask.ask.requestId;
      if (current.ask.kind === "permission") {
        await window.backchat.permissionRespond(requestId, optionId);
      } else {
        await window.backchat.fsApprovalRespond(requestId, !!approve);
      }
      sessionStore.dequeueAsk(current.sessionId, requestId);
    },
    [current],
  );

  const dismiss = useCallback(() => {
    if (!current) return;
    const decision = resolveAskDismissal(current.ask);
    void resolve(decision.optionId, decision.approve);
  }, [current, resolve]);

  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      {current && (
        <DialogContent
          className="max-w-md gap-0 overflow-hidden p-0"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            dismiss();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <ApprovalPrompt ask={current.ask} onResolve={resolve} />
        </DialogContent>
      )}
    </Dialog>
  );
}

export function ApprovalPrompt({
  ask,
  onResolve,
}: {
  ask: BrokerAsk;
  onResolve: (optionId: string | null, approve?: boolean) => void | Promise<void>;
}) {
  if (ask.kind === "fsWrite") {
    return (
      <>
        <DialogHeader className="border-b border-border/60 p-4">
          <DialogTitle>Write outside workspace?</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {ask.ask.path}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 p-4 text-xs text-fg-muted">
          <p>{ask.ask.byteSize} bytes will be written outside the active project.</p>
          {ask.ask.newPreview && (
            <pre className="max-h-44 overflow-auto rounded-lg bg-bg-surface/60 p-3 font-mono text-[11px] whitespace-pre-wrap">
              {ask.ask.newPreview}
            </pre>
          )}
        </div>
        <DialogFooter className="p-3">
          <Button type="button" variant="destructive" onClick={() => void onResolve(null, false)}>
            Deny
          </Button>
          <Button type="button" onClick={() => void onResolve(null, true)}>
            Allow write
          </Button>
        </DialogFooter>
      </>
    );
  }

  const presentation = permissionPresentation(ask.ask.toolCall);
  return (
    <>
      <DialogHeader className="border-b border-border/60 p-4">
        <DialogTitle>{presentation.title}</DialogTitle>
        <DialogDescription>
          This action is waiting for your approval.
        </DialogDescription>
      </DialogHeader>
      {(presentation.reason || presentation.command) && (
        <div className="space-y-2 p-4 text-xs text-fg-muted">
          {presentation.reason && <p className="leading-5">{presentation.reason}</p>}
          {presentation.command && (
            <pre className="max-h-44 overflow-auto rounded-lg bg-bg-surface/60 p-3 font-mono text-[11px] whitespace-pre-wrap">
              {presentation.command}
            </pre>
          )}
        </div>
      )}
      <DialogFooter className="p-3">
        {ask.ask.options.map((option) => (
          <Button
            key={option.optionId}
            type="button"
            variant={
              option.kind.startsWith("reject_")
                ? "destructive"
                : option.kind === "allow_once"
                  ? "default"
                  : "outline"
            }
            onClick={() => void onResolve(option.optionId)}
          >
            {option.name}
          </Button>
        ))}
      </DialogFooter>
    </>
  );
}

function permissionPresentation(toolCall: unknown): {
  title: string;
  reason?: string;
  command?: string;
} {
  const tool = record(toolCall);
  const rawInput = record(tool.rawInput ?? tool.raw_input);
  const codexParams = record(record(record(tool._meta).codex).params);
  return {
    title:
      stringValue(tool.title) ??
      stringValue(codexParams.title) ??
      "Approve this action?",
    reason:
      stringValue(codexParams.reason) ??
      stringValue(rawInput.reason),
    command:
      stringValue(codexParams.command) ??
      stringValue(rawInput.command) ??
      stringValue(rawInput.cmd),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
