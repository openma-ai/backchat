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
import type { AcpForkPoint } from "@openma/common/acp-runtime";
import { sessionUsesManagedWorkspace } from "./fork-workspace";
import type { OptimisticUserEcho } from "./optimistic-user-echo";
import type {
  SessionRow,
  SideSessionParentLink,
  Turn,
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

export interface DraftStartWorkspace {
  workspace_mode: SessionStartParams["workspace_mode"];
  cwd?: string;
  additional_directories?: string[];
  project_id?: string;
  workspace_id?: string;
  parent_session_id?: string;
  fork_kind?: "session" | "message";
}

function forkKindFor(
  link: Pick<SideSessionParentLink, "inheritance" | "point"> | undefined,
): "session" | "message" | undefined {
  if (link?.inheritance !== "fork") return undefined;
  return link.point ? "message" : "session";
}

/** Workspace a draft should start in.
 *
 *  Forks and side chats inherit the source session. A page-level picked
 *  directory is the composer's last project and must not replace that
 *  inheritance: a managed source stays managed (a new per-session folder),
 *  and a project source stays on the same project. */
export function resolveDraftStartWorkspace({
  target,
  isSide,
  pickedCwd,
}: {
  target: Pick<
    SessionRow,
    | "cwd"
    | "chosenCwd"
    | "projectScope"
    | "projectId"
    | "additionalDirectories"
    | "workspaceId"
    | "forkParent"
    | "sideParent"
  >;
  isSide: boolean;
  pickedCwd?: string | null;
}): DraftStartWorkspace {
  const forkLink = target.forkParent?.inheritance === "fork"
    ? target.forkParent
    : undefined;
  if (forkLink || isSide) {
    const managed = sessionUsesManagedWorkspace(target);
    const link = forkLink
      ?? (target.sideParent?.inheritance === "fork" ? target.sideParent : undefined);
    const lineage = {
      parent_session_id: link?.parentSessionId,
      fork_kind: forkKindFor(link),
    };
    if (forkLink && managed) {
      return { workspace_mode: "managed", ...lineage };
    }
    const cwd = (
      managed ? target.cwd : (target.chosenCwd || target.cwd)
    )?.trim() || undefined;
    const workspaceId = managed ? undefined : target.workspaceId?.trim() || undefined;
    return {
      workspace_mode: isSide
        ? "inherited"
        : resolveWorkspaceMode(
          managed ? "none" : "project",
          false,
          !!cwd,
          workspaceId,
        ),
      cwd,
      additional_directories: managed ? undefined : target.additionalDirectories,
      project_id: managed ? undefined : target.projectId,
      workspace_id: workspaceId,
      ...lineage,
    };
  }

  const startCwd = resolveChatStartCwd({
    pickedCwd: resolveProjectScopedPickedCwd(target.projectScope, pickedCwd),
    chosenCwd: target.chosenCwd,
    sessionCwd: target.cwd,
  });
  return {
    workspace_mode: resolveWorkspaceMode(
      target.projectScope,
      false,
      !!startCwd,
      target.workspaceId,
    ),
    cwd: startCwd,
    additional_directories: target.additionalDirectories,
    project_id: target.projectId,
    workspace_id: target.workspaceId ?? undefined,
  };
}

export function resolveChatFork(
  parentLink:
    | Pick<SideSessionParentLink, "inheritance" | "parentAcpSessionId" | "point">
    | undefined,
): { acp_session_id: string; point?: AcpForkPoint } | undefined {
  if (parentLink?.inheritance !== "fork" || !parentLink.parentAcpSessionId) {
    return undefined;
  }
  return {
    acp_session_id: parentLink.parentAcpSessionId,
    ...(parentLink.point ? { point: parentLink.point } : {}),
  };
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
  onOptimisticEcho,
}: {
  isSide: boolean;
  pickedAgentId: string | null;
  pickedCwd: string | null;
  onSuggestionSubmitted: () => void;
  /** Paint the user message before session start or session prompt IPC. */
  onOptimisticEcho?: (echo: OptimisticUserEcho) => void;
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
    onOptimisticEcho?.({
      clientId: turnId,
      text: displayText,
      createdAt: Date.now(),
      state: "pending",
    });
    sessionStore.registerTurn(
      turnId,
      target.id,
      displayText,
      delivery,
      sessionReferences,
      attachments,
      annotations,
    );

    try {
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
        const workspace = resolveDraftStartWorkspace({
          target,
          isSide,
          pickedCwd,
        });
        const startResult = await window.backchat.sessionStart({
          session_id: target.id,
          agent_id: draftAgentId,
          workspace_mode: workspace.workspace_mode,
          cwd: workspace.cwd,
          additional_directories: workspace.additional_directories,
          project_id: workspace.project_id,
          workspace_id: workspace.workspace_id,
          fork: resolveChatFork(parentLink),
          parent_session_id: workspace.parent_session_id,
          fork_kind: workspace.fork_kind,
        });
        if (startResult.status !== "ready") {
          const message = startResult.status === "error"
            ? startResult.message
            : "Couldn't start the session";
          if (startResult.status === "error" && parentLink?.inheritance === "fork") {
            toast.error(startResult.message);
          }
          sessionStore.failSend(turnId, message);
          return;
        }

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
        if (startResult.status !== "ready") {
          sessionStore.failSend(
            turnId,
            startResult.status === "error" ? startResult.message : "Couldn't start the session",
          );
          return;
        }
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sessionStore.failSend(turnId, message);
      toast.error(message);
    }
  };
}

/** Resubmit a send that failed before the host accepted it, using the same turn id. */
export async function retryFailedChatSend(turn: Turn): Promise<void> {
  const session = sessionStore.get(turn.sessionId);
  if (!session || session.sideKind === "subagent") return;
  const canPrompt = (session.status === "ready" || session.status === "running")
    && !!session.acp_session_id;
  sessionStore.reopenSend(turn.id);
  try {
    if (!canPrompt) {
      const workspace = resolveDraftStartWorkspace({
        target: session,
        isSide: session.kind === "side",
        pickedCwd: session.chosenCwd,
      });
      const parentLink = session.forkParent ?? session.sideParent ?? session.subagent;
      const started = await window.backchat.sessionStart({
        session_id: session.id,
        agent_id: session.agent_id,
        workspace_mode: workspace.workspace_mode,
        cwd: (workspace.cwd ?? session.cwd) || undefined,
        additional_directories: workspace.additional_directories ?? session.additionalDirectories,
        project_id: workspace.project_id ?? session.projectId,
        workspace_id: workspace.workspace_id ?? session.workspaceId ?? undefined,
        fork: resolveChatFork(parentLink),
        parent_session_id: workspace.parent_session_id,
        fork_kind: workspace.fork_kind,
        resume: session.acp_session_id
          ? { acp_session_id: session.acp_session_id }
          : undefined,
      });
      if (started.status !== "ready") {
        sessionStore.failSend(
          turn.id,
          started.status === "error" ? started.message : "Couldn't start the session",
        );
        return;
      }
    }
    await window.backchat.sessionPrompt({
      session_id: turn.sessionId,
      turn_id: turn.id,
      text: turn.promptText,
      ...(turn.attachments?.length ? { attachments: turn.attachments } : {}),
      ...(turn.annotations?.length ? { annotations: turn.annotations } : {}),
      ...(turn.sessionReferences?.length ? { session_references: turn.sessionReferences } : {}),
      prompt_intent: turn.promptIntent,
      requested_delivery: turn.requestedDelivery,
      effective_delivery: turn.effectiveDelivery,
      delivery_degraded: turn.deliveryDegraded,
    });
  } catch (error) {
    sessionStore.failSend(
      turn.id,
      error instanceof Error ? error.message : String(error),
    );
  }
}
