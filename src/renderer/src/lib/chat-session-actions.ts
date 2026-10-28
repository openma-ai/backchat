import { toast } from "sonner";

import type { ElicitationResponseInfo } from "@shared/api.js";
import type { PromptAnnotation } from "@shared/session-events.js";
import { promptAnnotationStore } from "./prompt-annotations";
import { wholeSessionForkEnabled } from "./fork-support";
import type { SessionRow, SubagentInheritance } from "./session-store";
import { sessionStore } from "./session-store";
import type { Turn } from "./session-types";
import { withActionTrace } from "./ui-trace";

type AskResponseInput =
  | { kind: "permission"; ask: { requestId: string } }
  | { kind: "fsWrite"; ask: { requestId: string } };

export type ChatAskResponse =
  | {
      kind: "permission";
      requestId: string;
      optionId: string;
    }
  | {
      kind: "fsWrite";
      requestId: string;
      approve: boolean;
    };

export function resolveChatAskResponse(
  ask: AskResponseInput,
  optionId: string | null,
  approve = false,
): ChatAskResponse | null {
  if (ask.kind === "permission") {
    return optionId
      ? {
          kind: "permission",
          requestId: ask.ask.requestId,
          optionId,
        }
      : null;
  }
  return {
    kind: "fsWrite",
    requestId: ask.ask.requestId,
    approve,
  };
}

export function resolveChatConfigSessionId(
  active: Pick<SessionRow, "id" | "status"> | null,
): string | null {
  return active && active.status !== "draft" ? active.id : null;
}

/**
 * Turn ids a stop press may still cancel.
 *
 * The composer shows its stop control whenever a turn is running *or* a send
 * is still pending, but `SessionRow.activeTurnId` is not guaranteed to be set
 * in both cases: the store clears it when a turn settles and it is never
 * filled for a send the host has not accepted yet. Without a fallback the
 * stop button is a silent no-op.
 *
 * Terminal turns are excluded — a cancelled, failed or completed turn cannot
 * be cancelled again.
 */
export function resolveChatCancelFallbackTurnIds(
  turns: readonly Pick<Turn, "id" | "status" | "sendState">[],
): string[] {
  return turns
    .filter(
      (turn) =>
        (turn.status === "running" || turn.sendState === "pending")
        && turn.status !== "cancelled"
        && turn.status !== "error"
        && turn.status !== "complete",
    )
    .map((turn) => turn.id);
}

/**
 * The turn a stop press targets. `activeTurnId` wins; otherwise the first
 * fallback turn (running or pending send) is used so the stop control always
 * reaches the host.
 */
export function resolveChatCancelTarget(
  active: Pick<SessionRow, "id" | "activeTurnId"> | null,
  isNativeSubagent: boolean,
  fallbackTurnIds: readonly string[] = [],
): { session_id: string; turn_id: string } | null {
  if (isNativeSubagent || !active) return null;
  const turnId = active.activeTurnId ?? fallbackTurnIds[0];
  return turnId ? { session_id: active.id, turn_id: turnId } : null;
}

/**
 * Cancel the active turn of a session. Shared by the composer and the
 * topbar so both stop paths resolve the same target and leave the same
 * telemetry behind.
 */
export function cancelChatActiveTurn(
  active: Pick<SessionRow, "id" | "activeTurnId" | "openma"> | null | undefined,
  isNativeSubagent: boolean,
): void {
  if (active?.openma) {
    void window.backchat
      .openmaTaskInterrupt(active.id)
      .catch((error) => toast.error(String(error)));
    return;
  }
  const fallbacks = active
    ? resolveChatCancelFallbackTurnIds(sessionStore.turnsFor(active.id))
    : [];
  const target = resolveChatCancelTarget(active ?? null, isNativeSubagent, fallbacks);
  withActionTrace(
    "turn.cancel",
    {
      "backchat.cancel.session_id": active?.id ?? "",
      "backchat.cancel.turn_id": target?.turn_id ?? "",
      "backchat.cancel.result": target ? "targeted" : "no_target",
    },
    () => {
      if (!target) return;
      void window.backchat.sessionCancel(target).catch((error) => {
        // Telemetry only — a failed cancel must not break the composer.
        console.warn("Cancel failed", error);
      });
    },
  );
}

export interface ResponseSideChatDraftInput {
  parentSessionId: string;
  parentAcpSessionId: string | undefined;
  inheritance: SubagentInheritance;
  agentId: string;
  cwd: string;
}

export function resolveResponseSideChatDraft({
  active,
  homePath,
}: {
  active: Pick<
    SessionRow,
    | "id"
    | "agent_id"
    | "cwd"
    | "acp_session_id"
    | "forkSupport"
  >;
  homePath: string;
}): ResponseSideChatDraftInput {
  const canFork =
    wholeSessionForkEnabled(active.forkSupport) && !!active.acp_session_id;
  return {
    parentSessionId: active.id,
    parentAcpSessionId: canFork ? active.acp_session_id : undefined,
    inheritance: canFork ? "fork" : "fresh",
    agentId: active.agent_id,
    cwd: active.cwd || homePath,
  };
}

export function useChatSessionActions({
  active,
  isNativeSubagent,
  isSide,
}: {
  active: SessionRow | null | undefined;
  isNativeSubagent: boolean;
  isSide: boolean;
}) {
  const setSessionConfigOption = async (
    configId: string,
    value: string | boolean,
  ) => {
    if (active?.openma) return;
    const sessionId = resolveChatConfigSessionId(active ?? null);
    if (!sessionId) return;
    try {
      await window.backchat.sessionSetConfigOption({
        session_id: sessionId,
        config_id: configId,
        value,
      });
    } catch (error) {
      toast.error("Couldn't switch model", {
        description:
          error instanceof Error ? error.message : String(error),
      });
    }
  };

  const resolveAsk = async (
    optionId: string | null,
    approve?: boolean,
    elicitation?: ElicitationResponseInfo,
  ) => {
    const ask = active?.pendingAsks?.[0];
    if (!active || !ask) return;
    if (active.openma) {
      try {
        if (ask.kind === "permission") {
          if (ask.openmaResponse === "runtime_permission") {
            if (optionId !== null && !ask.ask.options.some((option) => option.optionId === optionId)) return;
            const outcome = optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId };
            await window.backchat.openmaTaskRespond(active.id, ask.ask.requestId, { type: "custom_result", text: JSON.stringify({ outcome }) });
          } else {
            if (optionId !== "allow" && optionId !== "deny") return;
            await window.backchat.openmaTaskRespond(active.id, ask.ask.requestId, { type: "confirmation", result: optionId });
          }
        } else if (ask.kind === "elicitation") {
          const accepted = elicitation?.action === "accept" && "content" in elicitation;
          await window.backchat.openmaTaskRespond(active.id, ask.ask.requestId, { type: "custom_result", text: accepted ? String(elicitation.content.result ?? "") : "User declined to provide a result", isError: !accepted });
        }
        sessionStore.dequeueAsk(active.id, ask.ask.requestId);
      } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't send the response"); }
      return;
    }
    if (ask.kind === "elicitation") {
      await window.backchat.elicitationRespond(
        ask.ask.requestId,
        elicitation ?? { action: "cancel" },
      );
      sessionStore.dequeueAsk(active.id, ask.ask.requestId);
      return;
    }
    const response = resolveChatAskResponse(ask, optionId, !!approve);
    if (response?.kind === "permission") {
      await window.backchat.permissionRespond(
        response.requestId,
        response.optionId,
      );
    } else if (response?.kind === "fsWrite") {
      await window.backchat.fsApprovalRespond(
        response.requestId,
        response.approve,
      );
    }
    sessionStore.dequeueAsk(active.id, ask.ask.requestId);
  };

  const cancelActiveTurn = () => {
    cancelChatActiveTurn(active ?? null, isNativeSubagent);
  };

  const askInSideChat = isSide || active?.openma
    ? undefined
    : async (annotation: PromptAnnotation) => {
        if (!active) return;
        const hasExistingCwd = !!active.cwd;
        const homePath = hasExistingCwd
          ? ""
          : await window.backchat.uiFsHome();
        const input = resolveResponseSideChatDraft({
          active,
          homePath,
        });
        const sessionId = sessionStore.newSideDraft(input);
        promptAnnotationStore.add(sessionId, annotation);
        sessionStore.openSideTab("chat", sessionId, "Side chat");
      };

  return {
    askInSideChat,
    cancelActiveTurn,
    resolveAsk,
    setSessionConfigOption,
  };
}
