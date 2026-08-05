import {
  findSelectConfigOption,
  type AcpSessionConfigOption,
} from "./session-config-options";
import type { ComposerSessionStatePresentation } from "./composer-session-state";

export interface PlanModeSessionState {
  agentId: string;
  currentModeId?: string;
  configOptions?: readonly AcpSessionConfigOption[];
}

export interface PlanModeSessionStateLabels {
  label: string;
  title: string;
}

export function planModeSessionStatePresentation(
  state: PlanModeSessionState,
  labels: PlanModeSessionStateLabels,
): ComposerSessionStatePresentation | undefined {
  const currentModeId = state.currentModeId?.trim().toLowerCase();
  const codexCollaborationMode = findSelectConfigOption(
    state.configOptions,
    "collaboration_mode",
  )?.currentValue;
  const active =
    (state.agentId === "claude-acp" && currentModeId === "plan") ||
    (state.agentId === "codex-acp" &&
      (currentModeId === "plan" || codexCollaborationMode === "plan"));
  if (!active) return undefined;

  return {
    id: `mode:${state.agentId}:plan`,
    kind: "plan_mode",
    label: labels.label,
    title: labels.title,
    icon: "plan",
  };
}
