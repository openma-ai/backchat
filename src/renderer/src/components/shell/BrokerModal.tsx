/**
 * Root-mounted bridge for short-lived broker asks.
 *
 * The bridge only routes incoming asks into their owning SessionRow. Visual
 * presentation belongs to that session's composer, so a background session
 * can never interrupt the active one with a global modal.
 */

import { useEffect } from "react";

import { sessionStore, type BrokerAsk } from "@/lib/session-store";
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

export function BrokerAskBridge() {
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

  return null;
}
