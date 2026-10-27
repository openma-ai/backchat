import type { AgentInfo } from "@shared/api";
import { authMethodKind, preferredAuthMethod } from "@/lib/auth-method-menu";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The agent setup row speaks the same update vocabulary as the App update.
 *
 * "Update available", "Upgrading…" and "Checking…" come from the shared
 * `update.status.*` keys, so an agent row and the About page never describe
 * the same state with two different words.
 */
export type AgentSetupAction =
  | { kind: "install"; labelKey: TranslationKey }
  | { kind: "upgrade"; labelKey: TranslationKey }
  | { kind: "none"; labelKey: TranslationKey };

export type AgentAuthAction =
  | { kind: "sign-in"; labelKey: TranslationKey; ariaLabelKey: TranslationKey }
  | { kind: "open-setup"; labelKey: TranslationKey; ariaLabelKey: TranslationKey }
  | { kind: "configure"; labelKey: TranslationKey; ariaLabelKey: TranslationKey }
  | { kind: "probe"; labelKey: TranslationKey; ariaLabelKey: TranslationKey }
  | { kind: "none"; labelKey: TranslationKey; ariaLabelKey: TranslationKey };

export interface AgentSetupState {
  available: boolean;
  authNeeded: boolean;
  canEnable: boolean;
  /** Shared status vocabulary — resolved with `t()` at the call site. */
  statusKey: TranslationKey;
  versionText: string | null;
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
      ? { kind: "install", labelKey: "agents.install" }
      : agent.installed && agent.updateAvailable
        ? { kind: "upgrade", labelKey: "agents.upgrade" }
        : { kind: "none", labelKey: "agents.status.ready" };

  const authAction: AgentAuthAction =
    available && authNeeded && authType === "env_var"
        ? {
            kind: "configure",
            labelKey: "agents.auth.configure",
            ariaLabelKey: "agents.auth.configureAria",
          }
        : available && authNeeded && authType === "terminal"
          ? {
              kind: "open-setup",
              labelKey: waitingForAuth ? "agents.auth.openAgain" : "agents.auth.openSetup",
              ariaLabelKey: waitingForAuth
                ? "agents.auth.openSetupAgainAria"
                : "agents.auth.openSetupAria",
            }
        : available && authNeeded
          ? {
              kind: "sign-in",
              labelKey: waitingForAuth ? "agents.auth.openAgain" : "agents.auth.signIn",
              ariaLabelKey: waitingForAuth
                ? "agents.auth.signInAgainAria"
                : "agents.auth.signInAria",
            }
          : {
              kind: "none",
              labelKey: "agents.auth.openSetup",
              ariaLabelKey: "agents.auth.openSetupAria",
            };

  return {
    available,
    authNeeded,
    canEnable: available && !authNeeded,
    statusKey: statusKey(agent, { waitingForAuth }),
    versionText: versionText(agent),
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
  const explicit = methods.find((method) => method.id === selectedMethodId);
  if (explicit) return explicit;
  // A configured methodId is the user's saved choice, including terminal.
  // While auth is still required, a terminal methodId is only the probe's
  // first-method default, so it must not win over a browser or API-key method.
  const saved = methods.find((method) => method.id === agent.auth?.methodId);
  if (
    saved
    && (agent.auth?.status === "configured" || authMethodKind(saved) !== "terminal")
  ) {
    return saved;
  }
  return preferredAuthMethod(methods);
}

function authMethodType(
  method: NonNullable<NonNullable<AgentInfo["auth"]>["methods"]>[number] | undefined,
): string {
  return method?.type ?? "agent";
}

function statusKey(
  agent: AgentInfo,
  options: { waitingForAuth?: boolean },
): TranslationKey {
  if (options.waitingForAuth) return "agents.status.waitingAuth";
  if (agent.auth?.status === "needs-auth") return "agents.status.authNeeded";
  if (agent.auth?.status === "unknown") return "agents.status.authUnknown";
  if (agent.auth?.status === "configured") return "agents.status.authConfigured";
  if (agent.available ?? agent.detected) {
    // Same word as the App update row: "Update available".
    if (agent.updateAvailable) return "update.status.updateAvailable";
    return agent.installed ? "agents.status.installed" : "agents.status.ready";
  }
  return agent.installable ? "agents.status.notInstalled" : "agents.status.missing";
}

function versionText(agent: AgentInfo): string | null {
  if (agent.installedVersion && agent.latestVersion && agent.updateAvailable) {
    return `${agent.installedVersion} → ${agent.latestVersion}`;
  }
  return agent.installedVersion ?? null;
}
