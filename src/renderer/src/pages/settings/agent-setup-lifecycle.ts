import type { AgentInfo } from "@shared/api";

export type AgentSetupAction =
  | { kind: "install"; label: string }
  | { kind: "upgrade"; label: string }
  | { kind: "none"; label: string };

export type AgentAuthAction =
  | { kind: "sign-in"; label: string; ariaLabel: string }
  | { kind: "open-setup"; label: string; ariaLabel: string }
  | { kind: "configure"; label: string; ariaLabel: string }
  | { kind: "probe"; label: string; ariaLabel: string }
  | { kind: "none"; label: string; ariaLabel: string };

export interface AgentSetupState {
  available: boolean;
  authNeeded: boolean;
  canEnable: boolean;
  statusText: string;
  setupAction: AgentSetupAction;
  authAction: AgentAuthAction;
  authMethod?: NonNullable<NonNullable<AgentInfo["auth"]>["methods"]>[number];
}

export function deriveAgentSetupState(
  agent: AgentInfo,
  options: { waitingForAuth?: boolean; selectedMethodId?: string } = {},
): AgentSetupState {
  const available = agent.available ?? agent.detected;
  const authNeeded =
    agent.auth?.status === "needs-auth" || agent.auth?.status === "unknown";
  const authMethod = selectedAuthMethod(agent, options.selectedMethodId);
  const authType = authMethodType(authMethod);
  const waitingForAuth = options.waitingForAuth && authNeeded;

  const setupAction: AgentSetupAction =
    agent.installable && !agent.installed
      ? { kind: "install", label: "Install" }
      : agent.installed && agent.updateAvailable
        ? { kind: "upgrade", label: "Upgrade" }
        : { kind: "none", label: "" };

  const authAction: AgentAuthAction =
    available && authNeeded && authType === "env_var"
        ? {
            kind: "configure",
            label: "Configure",
            ariaLabel: `Configure ${agent.label} credentials`,
          }
        : available && authNeeded && authType === "terminal"
          ? {
              kind: "open-setup",
              label: waitingForAuth ? "Open again" : "Open setup",
              ariaLabel: waitingForAuth
                ? `Open ${agent.label} setup again`
                : `Open ${agent.label} setup`,
            }
        : available && authNeeded
          ? {
              kind: "sign-in",
              label: waitingForAuth ? "Open again" : "Sign in",
              ariaLabel: waitingForAuth
                ? `Open ${agent.label} sign in again`
                : `Sign in to ${agent.label}`,
            }
          : {
              kind: "none",
              label: "",
              ariaLabel: "",
            };

  return {
    available,
    authNeeded,
    canEnable: available && !authNeeded,
    statusText: statusText(agent, { waitingForAuth }),
    setupAction,
    authAction,
    ...(authMethod ? { authMethod } : {}),
  };
}

export function selectedAuthMethod(
  agent: AgentInfo,
  selectedMethodId?: string,
): NonNullable<NonNullable<AgentInfo["auth"]>["methods"]>[number] | undefined {
  const methods = agent.auth?.methods ?? [];
  return methods.find((method) => method.id === selectedMethodId) ??
    methods.find((method) => method.id === agent.auth?.methodId) ??
    methods[0];
}

function authMethodType(
  method: NonNullable<NonNullable<AgentInfo["auth"]>["methods"]>[number] | undefined,
): string {
  return method?.type ?? "agent";
}

function statusText(
  agent: AgentInfo,
  options: { waitingForAuth?: boolean },
): string {
  if (options.waitingForAuth) return "Waiting for auth";
  if (agent.auth?.status === "needs-auth") return "Auth needed";
  if (agent.auth?.status === "unknown") return "Auth unknown";
  if (agent.auth?.status === "configured") return "Auth configured";
  if (agent.available ?? agent.detected) {
    if (agent.updateAvailable) return "Update available";
    if (agent.installedVersion) return `Installed ${agent.installedVersion}`;
    return agent.installed ? "Installed" : "Ready";
  }
  return agent.installable ? "Not installed" : "Missing";
}
