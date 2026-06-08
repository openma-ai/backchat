/**
 * Broker listener — subscribes to permission + fs-write asks pushed
 * by main, applies the renderer-side auto-pick gate (per
 * settings.default.permission_mode), and routes any leftover asks
 * into the session store's per-session pending queue.
 *
 * NO MODAL. ChatView renders the queue head as a floating panel above
 * the composer instead — the modal flow (image #62) felt heavy and
 * the popped-up dialog blocked context. The listener still owns the
 * IPC subscription so the gate's auto-pick path runs even when no
 * ChatView is mounted.
 *
 * Filename kept as `BrokerModal.tsx` for now to avoid touching the
 * ShellLayout import; the component renders nothing.
 */

import { useEffect } from "react";
import { sessionStore } from "@/lib/session-store";
import { getSettings } from "@/lib/settings-store";
import type { PermissionAskInfo } from "@shared/api.js";

/** Auto-pick rules for the renderer-side permission gate. See
 *  settings-store.ts SettingsSchema.default.permission_mode for the
 *  three modes. `"modal"` means "fall through to the queued UI" — the
 *  ask gets enqueued for the inline panel. */
function autoPickPermission(
  ask: PermissionAskInfo,
  mode: "ask" | "auto" | "read_only",
): string | "modal" {
  if (mode === "ask") return "modal";
  const want = mode === "auto" ? "allow_once" : "reject_once";
  const exact = ask.options.find((o) => o.kind === want);
  if (exact) return exact.optionId;
  const prefix = mode === "auto" ? "allow_" : "reject_";
  const fuzzy = ask.options.find((o) => o.kind.startsWith(prefix));
  return fuzzy?.optionId ?? "modal";
}

export function BrokerModal() {
  useEffect(() => {
    const offP = window.backchat.onPermissionRequest((ask) => {
      const mode = getSettings()?.default.permission_mode ?? "ask";
      const pick = autoPickPermission(ask, mode);
      if (pick !== "modal") {
        // Auto-respond inline — never enters the queue, so the user
        // doesn't see a panel flash in and out.
        void window.backchat.permissionRespond(ask.requestId, pick);
        return;
      }
      sessionStore.enqueueAsk(ask.sessionId, { kind: "permission", ask });
    });
    const offF = window.backchat.onFsWriteApproval((ask) => {
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
    return () => {
      offP();
      offF();
    };
  }, []);

  return null;
}
