import type { AgentInfo } from "../shared/api.js";
import type { SettingsAgentOverride } from "../shared/settings.js";
import {
  createAcpAgentSetupService,
  launchTerminalAuth as launchAcpTerminalAuth,
  type AcpAgentSetupOverride,
  type AcpAgentSetupService,
  type AcpAgentSetupServiceDeps,
  type TerminalAuthLaunchOptions,
} from "@open-managed-agents-desktop/acp-agent-setup";

export interface AgentSetupServiceDeps extends Omit<
  AcpAgentSetupServiceDeps,
  "agentOverrides" | "managedByName"
> {
  agentOverrides?: () => SettingsAgentOverride[];
}

export interface AgentSetupService {
  warmup(): Promise<void>;
  refreshEnabledAgents(): Promise<AgentInfo[]>;
  listAgents(): Promise<AgentInfo[]>;
  installAgent(id: string): Promise<AgentInfo[]>;
  upgradeAgent(id: string): Promise<AgentInfo[]>;
  uninstallAgent(id: string): Promise<AgentInfo[]>;
  authenticateAgent(id: string, options?: { methodId?: string }): Promise<AgentInfo[]>;
  dispose(): Promise<void>;
}

export function createAgentSetupService(deps: AgentSetupServiceDeps): AgentSetupService {
  const { agentOverrides, ...acpDeps } = deps;
  const service: AcpAgentSetupService = createAcpAgentSetupService({
    ...acpDeps,
    managedByName: "OpenMA",
    ...(agentOverrides
      ? { agentOverrides: () => agentOverrides().map(settingsAgentOverrideToAcpOverride) }
      : {}),
  });
  return service as unknown as AgentSetupService;
}

export function launchTerminalAuth(options: TerminalAuthLaunchOptions): Promise<void> {
  return launchAcpTerminalAuth(options, {
    returnInstruction: "Return to OpenMA after authentication completes. Setup status is checked automatically.",
  });
}

function settingsAgentOverrideToAcpOverride(override: SettingsAgentOverride): AcpAgentSetupOverride {
  return {
    id: override.id,
    ...(override.label_override ? { label: override.label_override } : {}),
    ...(override.command_override ? { command: override.command_override } : {}),
    ...(override.args_override ? { args: override.args_override } : {}),
    env: override.env,
  };
}
