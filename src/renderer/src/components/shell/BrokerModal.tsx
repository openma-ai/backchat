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
import { ElicitationAskForm } from "@/components/chat/ElicitationAskForm";
import type { ElicitationResponseInfo } from "@shared/api.js";

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
    const offElicitation = window.backchat.onElicitationRequest((ask) => {
      sessionStore.enqueueAsk(ask.sessionId, { kind: "elicitation", ask });
    });
    void window.backchat.brokerPendingAsks().then((asks) => {
      for (const pending of asks) {
        sessionStore.enqueueAsk(pending.ask.sessionId, pending);
      }
    });
    return () => {
      offPermission();
      offElicitation();
      offWrite();
    };
  }, []);

  const resolve = useCallback(
    async (
      optionId: string | null,
      approve?: boolean,
      elicitation?: ElicitationResponseInfo,
    ) => {
      if (!current) return;
      const requestId = current.ask.ask.requestId;
      if (current.ask.kind === "permission") {
        await window.backchat.permissionRespond(requestId, optionId);
      } else if (current.ask.kind === "elicitation") {
        await window.backchat.elicitationRespond(
          requestId,
          elicitation ?? { action: "cancel" },
        );
      } else {
        await window.backchat.fsApprovalRespond(requestId, !!approve);
      }
      sessionStore.dequeueAsk(current.sessionId, requestId);
    },
    [current],
  );

  const dismiss = useCallback(() => {
    if (!current) return;
    if (current.ask.kind === "elicitation") {
      void resolve(null, undefined, { action: "cancel" });
      return;
    }
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
  onResolve: (
    optionId: string | null,
    approve?: boolean,
    elicitation?: ElicitationResponseInfo,
  ) => void | Promise<void>;
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

  if (ask.kind === "elicitation") {
    if (ask.ask.mode === "url") {
      const host = elicitationUrlHost(ask.ask.url);
      return (
        <>
          <DialogHeader className="border-b border-border/60 p-4">
            <DialogTitle>{ask.ask.message}</DialogTitle>
            <DialogDescription>
              This agent wants to open an external page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 p-4 text-xs text-fg-muted">
            <p>Review the full target before continuing.</p>
            <pre className="max-h-32 overflow-auto rounded-lg bg-bg-surface/60 p-3 font-mono text-[11px] whitespace-pre-wrap break-all">
              {ask.ask.url}
            </pre>
          </div>
          <DialogFooter className="p-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void onResolve(null, undefined, { action: "decline" })}
            >
              Decline
            </Button>
            <Button
              type="button"
              onClick={() => void onResolve(null, undefined, { action: "accept" })}
            >
              Open {host}
            </Button>
          </DialogFooter>
        </>
      );
    }
    return (
      <>
        <DialogHeader className="border-b border-border/60 p-4">
          <DialogTitle>{ask.ask.message}</DialogTitle>
          <DialogDescription>
            This agent is waiting for structured input.
          </DialogDescription>
        </DialogHeader>
        <ElicitationAskForm
          ask={ask.ask}
          onSubmit={(response) => onResolve(null, undefined, response)}
        />
      </>
    );
  }

  const presentation = ask.ask.presentation;
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

function elicitationUrlHost(url: string): string {
  try {
    return new URL(url).host || "external page";
  } catch {
    return "external page";
  }
}
