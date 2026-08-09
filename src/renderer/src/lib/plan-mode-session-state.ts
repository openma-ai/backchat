import {
  findSelectConfigOption,
  flattenSelectOptions,
  type AcpSessionConfigOption,
} from "./session-config-options";
import { slashCommandConfigAction } from "./composer-slash-commands";
import type { AcpAvailableCommand } from "./session-store";
import type { ComposerSessionStatePresentation } from "./composer-session-state";

export interface PlanModeSessionState {
  agentId: string;
  currentModeId?: string;
  configOptions?: readonly AcpSessionConfigOption[];
  /** Composer draft overrides — a not-yet-started session keeps its plan
   * choice here until the agent publishes real config options. */
  draftConfigValues?: Record<string, string | boolean>;
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
      (currentModeId === "plan" ||
        codexCollaborationMode === "plan" ||
        (codexCollaborationMode === undefined &&
          state.draftConfigValues?.["collaboration_mode"] === "plan")));
  if (!active) return undefined;

  return {
    id: `mode:${state.agentId}:plan`,
    kind: "plan_mode",
    label: labels.label,
    title: labels.title,
    icon: "plan",
  };
}

/** The config change that leaves plan mode. The agent's own `/plan`
 * command names the reset value in `_meta.commandAction`; otherwise the
 * first non-plan option of the collaboration select is the exit. Sessions
 * whose plan state only exists as a read-only mode id (no writable config
 * option) return undefined — the chip then renders without a dismiss. */
export function planModeExitAction({
  configOptions,
  availableCommands,
  draftConfigValues,
}: {
  configOptions?: readonly AcpSessionConfigOption[];
  availableCommands?: readonly AcpAvailableCommand[];
  draftConfigValues?: Record<string, string | boolean>;
}): { configId: string; value: string | boolean } | undefined {
  const option = findSelectConfigOption(configOptions, "collaboration_mode");
  if (!option) {
    // Draft-only plan state: clearing the override is the exit.
    return draftConfigValues?.["collaboration_mode"] === "plan"
      ? { configId: "collaboration_mode", value: "default" }
      : undefined;
  }
  if (option.currentValue !== "plan") return undefined;
  for (const command of availableCommands ?? []) {
    const action = slashCommandConfigAction(command);
    if (
      action?.configId === option.id &&
      action.resetValue !== undefined &&
      action.resetValue !== option.currentValue
    ) {
      return { configId: option.id, value: action.resetValue };
    }
  }
  const fallback = flattenSelectOptions(option).find(
    (item) => item.value !== option.currentValue,
  );
  return fallback ? { configId: option.id, value: fallback.value } : undefined;
}
