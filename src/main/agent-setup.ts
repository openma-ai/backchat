import type { AgentInfo } from "../shared/api.js";
import type { SettingsAgentOverride } from "../shared/settings.js";
import {
  createAcpAgentSetupService,
  launchTerminalAuth as launchAcpTerminalAuth,
  type AcpAgentListOptions,
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

export type AgentListOptions = AcpAgentListOptions;

export interface AgentSetupService {
  warmup(): Promise<void>;
  listAgents(options?: AgentListOptions): Promise<AgentInfo[]>;
  probeAgent(id: string): Promise<AgentInfo[]>;
  installAgent(id: string): Promise<AgentInfo[]>;
  upgradeAgent(id: string): Promise<AgentInfo[]>;
  uninstallAgent(id: string): Promise<AgentInfo[]>;
  authenticateAgent(id: string, options?: { methodId?: string }): Promise<AgentInfo[]>;
  setDefaultAgent(id: string): Promise<AgentInfo[]>;
}

export function createAgentSetupService(deps: AgentSetupServiceDeps): AgentSetupService {
  const { agentOverrides, ...acpDeps } = deps;
  const service: AcpAgentSetupService = createAcpAgentSetupService({
    ...acpDeps,
    managedByName: "Backchat",
    ...(agentOverrides
      ? { agentOverrides: () => agentOverrides().map(settingsAgentOverrideToAcpOverride) }
      : {}),
  });
  return service as unknown as AgentSetupService;
}

export function launchTerminalAuth(options: TerminalAuthLaunchOptions): Promise<void> {
  return launchAcpTerminalAuth(options, {
    returnInstruction: "Return to Backchat and click Check again after authentication completes.",
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
