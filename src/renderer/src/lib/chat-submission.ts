import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import type { AgentMessageIntent } from "@shared/agent-interaction.js";
import type {
  PromptAnnotation,
  PromptAttachment,
  PromptSessionReference,
  SessionStartParams,
} from "@shared/session-events.js";
import { describeRunningMessageAction } from "./composer-delivery";
import {
  deriveChatLabel,
  derivePromptDisplayText,
} from "./composer-prompt";
import type {
  SessionRow,
  SideSessionParentLink,
  TurnDeliveryMeta,
} from "./session-store";
import {
  newDraftSession,
  newSideDraftSession,
  sessionStore,
} from "./session-store";

export function resolveChatSubmitAgentId({
  target,
  selectedAgentId,
  pickedAgentId,
}: {
  target: Pick<SessionRow, "status" | "agent_id"> | null;
  selectedAgentId?: string;
  pickedAgentId?: string | null;
}): string {
  if (target && target.status !== "draft") return target.agent_id;
  return selectedAgentId || pickedAgentId || target?.agent_id || "";
}

export function resolveChatStartCwd({
  pickedCwd,
  chosenCwd,
  sessionCwd,
}: {
  pickedCwd?: string | null;
  chosenCwd?: string | null;
  sessionCwd?: string | null;
}): string | undefined {
  return (
    pickedCwd?.trim()
    || chosenCwd?.trim()
    || sessionCwd?.trim()
    || undefined
  );
}

export function resolveProjectScopedPickedCwd(
  projectScope: SessionRow["projectScope"],
  pickedCwd: string | null | undefined,
): string | undefined {
  return projectScope === "project"
    ? pickedCwd?.trim() || undefined
    : undefined;
}

/** Project chats run in the project's own source folders (the live
 *  workspace) unless the draft picked a managed/external workspace, in which
 *  case the checkout set is resolved by id. */
export function resolveWorkspaceMode(
  projectScope: SessionRow["projectScope"],
  isSide = false,
  hasProjectCwd = true,
  workspaceId?: string | null,
): SessionStartParams["workspace_mode"] {
  if (isSide) return "inherited";
  if (projectScope === "none") return "managed";
  if (projectScope === "project") {
    if (!hasProjectCwd) return "managed";
    return workspaceId ? "worktree" : "project";
  }
  return undefined;
}

export function resolveChatFork(
  parentLink:
    | Pick<SideSessionParentLink, "inheritance" | "parentAcpSessionId">
    | undefined,
): { acp_session_id: string } | undefined {
  return parentLink?.inheritance === "fork" && parentLink.parentAcpSessionId
    ? { acp_session_id: parentLink.parentAcpSessionId }
    : undefined;
}

export function chatIdleDeliveryMeta(
  intent: AgentMessageIntent,
): TurnDeliveryMeta {
  return {
    intent,
    requestedDelivery: "turn_end",
    effectiveDelivery: "turn_end",
    degraded: false,
  };
}

export function useChatSubmission({
  isSide,
  pickedAgentId,
  pickedCwd,
  onSuggestionSubmitted,
}: {
  isSide: boolean;
  pickedAgentId: string | null;
  pickedCwd: string | null;
  onSuggestionSubmitted: () => void;
}) {
  const navigate = useNavigate();

  const resolveRunningDeliveryMeta = (
    session: Pick<SessionRow, "agent_id" | "supportsSteering">,
    intent: AgentMessageIntent,
  ): TurnDeliveryMeta | null => {
    const action = describeRunningMessageAction({
      agentId: session.agent_id,
      intent,
      supportsSteering: session.supportsSteering,
    });
    if (action.disabled) {
      toast.error(`${action.label} is not available`, {
        description: action.title,
      });
      return null;
    }
    return {
      intent,
      requestedDelivery: action.decision.requestedDelivery,
      effectiveDelivery: action.decision.effectiveDelivery,
      degraded: action.decision.degraded,
    };
  };

  return async (
    text: string,
    attachments: PromptAttachment[] = [],
    intent: AgentMessageIntent = "submit",
    configOverrides: Record<string, string | boolean> = {},
    selectedAgentId?: string,
    annotations: PromptAnnotation[] = [],
    sessionReferences: PromptSessionReference[] = [],
  ) => {
    // Resolve from the live store so a fast submit after navigation cannot
    // reuse the previous session captured by a render closure.
    let target = isSide ? sessionStore.sideActive() : sessionStore.active();
    if (target?.executionTarget || target?.openma) {
      if (isSide) return;
      if (attachments.length || annotations.length || sessionReferences.length) {
        toast.error("This remote task accepts text. Add files through its OpenMA environment.");
        return;
      }
      try {
        if (!target.openma) {
          const snapshot = await window.backchat.openmaTaskCreate(target.executionTarget!, deriveChatLabel(text));
          // Logout or revocation can remove the draft while creation is pending.
          if (!sessionStore.get(target.id)?.executionTarget) return;
          sessionStore.applyOpenmaSnapshot(snapshot);
          sessionStore.setActive(snapshot.task.id);
          target = sessionStore.get(snapshot.task.id)!;
          void navigate({ to: "/chat/$sessionId", params: { sessionId: target.id } });
        }
        onSuggestionSubmitted();
        await window.backchat.openmaTaskSend(target.id, crypto.randomUUID(), text);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "OpenMA request failed");
      }
      return;
    }
    const draftAgentId = resolveChatSubmitAgentId({
      target,
      selectedAgentId,
      pickedAgentId,
    });
    if (!draftAgentId) {
      toast.error("No harness setup", {
        description: "Install and enable an ACP agent in Settings first.",
        action: {
          label: "Open Settings",
          onClick: () => void navigate({ to: "/settings/agents" }),
        },
      });
      return;
    }
    if (!target) {
      const sessionId = isSide ? newSideDraftSession() : newDraftSession();
      target = sessionStore.get(sessionId)!;
      if (!isSide && pickedCwd?.trim()) {
        sessionStore.setChosenCwd(sessionId, pickedCwd);
        target = sessionStore.get(sessionId)!;
      }
      if (!isSide) {
        void navigate({
          to: "/chat/$sessionId",
          params: { sessionId },
        });
      }
    }
    if (target.sideKind === "subagent") return;

    const isRunningTarget =
      target.status === "running" || !!target.activeTurnId;
    const delivery = isRunningTarget
      ? resolveRunningDeliveryMeta(target, intent)
      : chatIdleDeliveryMeta(intent);
    if (!delivery) return;

    onSuggestionSubmitted();

    const turnId = `turn-${Math.random().toString(36).slice(2, 10)}`;
    const displayText = derivePromptDisplayText(
      text,
      attachments,
      annotations.length,
      sessionReferences.length,
    );
    sessionStore.registerTurn(
      turnId,
      target.id,
      displayText,
      delivery,
      sessionReferences,
      attachments,
    );

    if (target.status === "draft") {
      sessionStore.promoteDraft(
        target.id,
        draftAgentId,
        deriveChatLabel(displayText),
      );
      if (!isSide) {
        void navigate({
          to: "/chat/$sessionId",
          params: { sessionId: target.id },
        });
      }
      const parentLink = target.forkParent ?? target.sideParent ?? target.subagent;
      const startCwd = resolveChatStartCwd({
        pickedCwd: resolveProjectScopedPickedCwd(
          target.projectScope,
          pickedCwd,
        ),
        chosenCwd: target.chosenCwd,
        sessionCwd: target.cwd,
      });
      const startResult = await window.backchat.sessionStart({
        session_id: target.id,
        agent_id: draftAgentId,
        workspace_mode: resolveWorkspaceMode(
          target.projectScope,
          isSide,
          !!startCwd,
          target.workspaceId,
        ),
        cwd: startCwd,
        additional_directories: target.additionalDirectories,
        project_id: target.projectId,
        workspace_id: target.workspaceId ?? undefined,
        fork: resolveChatFork(parentLink),
      });
      if (startResult.status !== "ready") return;

      for (const [config_id, value] of Object.entries(configOverrides)) {
        try {
          await window.backchat.sessionSetConfigOption({
            session_id: target.id,
            config_id,
            value,
          });
        } catch (error) {
          toast.error("Couldn't switch model", {
            description:
              error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else if (target.status === "ready" && !target.activeTurnId) {
      const startResult = await window.backchat.sessionStart({
        session_id: target.id,
        agent_id: target.agent_id,
        cwd: target.cwd || undefined,
        additional_directories: target.additionalDirectories,
        project_id: target.projectId,
        workspace_id: target.workspaceId ?? undefined,
        resume: target.acp_session_id
          ? { acp_session_id: target.acp_session_id }
          : undefined,
      });
      if (startResult.status !== "ready") return;
    }

    await window.backchat.sessionPrompt({
      session_id: target.id,
      turn_id: turnId,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(annotations.length > 0 ? { annotations } : {}),
      ...(sessionReferences.length > 0 ? { session_references: sessionReferences } : {}),
      prompt_intent: delivery.intent,
      requested_delivery: delivery.requestedDelivery,
      effective_delivery: delivery.effectiveDelivery,
      delivery_degraded: delivery.degraded,
    });
  };
}
