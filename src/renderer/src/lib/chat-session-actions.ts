import { toast } from "sonner";

import type { PromptAnnotation } from "@shared/session-events.js";
import { promptAnnotationStore } from "./prompt-annotations";
import type { SessionRow, SubagentInheritance } from "./session-store";
import { sessionStore } from "./session-store";

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

export function resolveChatCancelTarget(
  active: Pick<SessionRow, "id" | "activeTurnId"> | null,
  isNativeSubagent: boolean,
): { session_id: string; turn_id: string } | null {
  return !isNativeSubagent && active?.activeTurnId
    ? { session_id: active.id, turn_id: active.activeTurnId }
    : null;
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
    | "supportsSessionFork"
  >;
  homePath: string;
}): ResponseSideChatDraftInput {
  const canFork =
    !!active.supportsSessionFork && !!active.acp_session_id;
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
  ) => {
    const ask = active?.pendingAsks?.[0];
    if (!active || !ask) return;
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
    const target = resolveChatCancelTarget(
      active ?? null,
      isNativeSubagent,
    );
    if (target) void window.backchat.sessionCancel(target);
  };

  const askInSideChat = isSide
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
