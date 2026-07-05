import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CircleIcon,
  CpuIcon,
  DownloadIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useSettings, patchSettings } from "@/lib/settings-store";
import { isAgentEnabled } from "@/lib/enabled-agents";
import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";
import {
  deriveAgentSetupState,
  selectedAuthMethod,
} from "./agent-setup-lifecycle";
import {
  customAgentRows,
  removeCustomAgentServer,
  upsertCustomAgentServer,
  type CustomAgentFormState,
} from "./custom-agent-settings";

type AgentAction = {
  type: "install" | "upgrade" | "uninstall" | "auth" | "probe" | "refresh" | "default";
  id?: string;
  methodId?: string;
};

/**
 * Settings → Agents.
 *
 * The user picks ONE default agent (radio across detected agents). New chats
 * spawn that agent — the "default browser" model. Registry-managed installs,
 * upgrades, auth probes, and credential env overrides stay on this page so
 * setup is one flow.
 *
 * Undetected agents are listed in a dim row with their installHint so the
 * user can copy/paste the command into their terminal.
 */
export function SettingsAgents() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [configuringAgentId, setConfiguringAgentId] = useState<string | null>(null);
  const [waitingAuthAgentId, setWaitingAuthAgentId] = useState<string | null>(null);
  const [selectedAuthMethodByAgent, setSelectedAuthMethodByAgent] = useState<Record<string, string>>({});
  const [customForm, setCustomForm] = useState<CustomAgentFormState | null>(null);
  const { data: agents = [], isLoading: agentsLoading, error: agentsError } = useQuery({
    queryKey: ["agents", "setup"],
    queryFn: () => window.backchat.agentsList(),
  });
  const action = useMutation({
    mutationFn: async (input: AgentAction) => {
      if (input.type === "install" && input.id) {
        const next = await window.backchat.agentInstall(input.id);
        const installed = next.find((item) => item.id === input.id);
        if (settings && installed && deriveAgentSetupState(installed).canDefault) {
          await patchSettings({
            agents: upsertAgentEnabled(settings, input.id, true),
          });
        }
        if (installed && deriveAgentSetupState(installed).canDefault) {
          return window.backchat.agentSetDefault(input.id);
        }
        return next;
      }
      if (input.type === "upgrade" && input.id) return window.backchat.agentUpgrade(input.id);
      if (input.type === "uninstall" && input.id) return window.backchat.agentUninstall(input.id);
      if (input.type === "auth" && input.id) {
        return window.backchat.agentAuthenticate({ id: input.id, methodId: input.methodId });
      }
      if (input.type === "probe" && input.id) return window.backchat.agentProbe(input.id);
      if (input.type === "default" && input.id) {
        if (settings) {
          await patchSettings({
            agents: upsertAgentEnabled(settings, input.id, true),
          });
        }
        return window.backchat.agentSetDefault(input.id);
      }
      return window.backchat.agentsList({ refresh: true });
    },
    onSuccess: (next, variables) => {
      queryClient.setQueryData(["agents", "setup"], next);
      if (variables.type === "auth" && variables.id) {
        const agent = next.find((item) => item.id === variables.id);
        setWaitingAuthAgentId(agent?.auth?.status === "configured" ? null : variables.id);
      } else if ((variables.type === "probe" || variables.type === "refresh") && waitingAuthAgentId) {
        const agent = next.find((item) => item.id === waitingAuthAgentId);
        if (agent?.auth?.status === "configured") setWaitingAuthAgentId(null);
      } else if (variables.type === "install" || variables.type === "uninstall" || variables.type === "upgrade") {
        setWaitingAuthAgentId(null);
      }
    },
  });

  const defaultId = settings?.default.agent_id ?? "";
  const available = agents.filter((a) => a.available ?? a.detected);
  const unavailable = agents.filter((a) => !(a.available ?? a.detected));
  const customRows = settings ? customAgentRows(settings) : [];

  useEffect(() => {
    if (!waitingAuthAgentId) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = async () => {
      attempts += 1;
      try {
        const next = await window.backchat.agentProbe(waitingAuthAgentId);
        if (cancelled) return;
        queryClient.setQueryData(["agents", "setup"], next);
        const agent = next.find((item) => item.id === waitingAuthAgentId);
        if (agent?.auth?.status === "configured" || !authStillBlocks(agent)) {
          setWaitingAuthAgentId(null);
          return;
        }
      } catch {
        // External auth often leaves the agent in flux. Keep the row waiting
        // until the short polling budget expires.
      }
      if (!cancelled && attempts < 150) {
        timer = setTimeout(probe, 4_000);
      } else if (!cancelled) {
        setWaitingAuthAgentId(null);
      }
    };
    timer = setTimeout(probe, 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [queryClient, waitingAuthAgentId]);

  const saveCustomAgent = async () => {
    if (!settings || !customForm) return;
    await patchSettings({
      agents: upsertCustomAgentServer(settings, customForm),
    });
    setCustomForm(null);
    action.mutate({ type: "refresh" });
  };

  const removeCustomAgent = async (id: string) => {
    if (!settings) return;
    await patchSettings({
      agents: removeCustomAgentServer(settings, id),
    });
    if (settings.default.agent_id === id) {
      await window.backchat.agentSetDefault("");
    }
    action.mutate({ type: "refresh" });
  };

  const setPromptQueueEnabled = async (enabled: boolean) => {
    if (!settings) return;
    await patchSettings({
      default: {
        ...settings.default,
        prompt_queue_enabled: enabled,
      },
    });
  };

  const setAgentEnabled = async (agentId: string, enabled: boolean) => {
    if (!settings) return;
    await patchSettings({
      agents: upsertAgentEnabled(settings, agentId, enabled),
    });
  };

  return (
    <div className="space-y-10 text-xs">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-sm font-medium text-fg">Agents</h1>
            <p className="mt-1 max-w-[62ch] text-[11px] leading-5 text-fg-muted">
              Pick the ACP agent used for new chats. Install, auth, and credential
              checks stay local.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => action.mutate({ type: "refresh" })}
            disabled={action.isPending}
            className="h-7 gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"
          >
            <RefreshCwIcon className="size-3.5" />
            {action.isPending && action.variables?.type === "refresh" ? "Checking…" : "Check again"}
          </Button>
        </div>
        {action.error && (
          <p className="mt-2 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
            {action.error instanceof Error ? action.error.message : String(action.error)}
          </p>
        )}
        {agentsError && (
          <p className="mt-2 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
            {agentsError instanceof Error ? agentsError.message : String(agentsError)}
          </p>
        )}
      </header>

      <section>
        <SectionHeading className="mb-4" label="Default agent" detail={`${available.length} available`} />
        {agentsLoading ? (
          <div className="flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 text-xs text-fg-muted">
            <RefreshCwIcon className="size-4 shrink-0 animate-spin text-fg-subtle" />
            Loading agents…
          </div>
        ) : available.length === 0 ? (
          <div className="flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 text-xs text-fg-muted hover:bg-bg-surface/60">
            <CpuIcon className="size-4 shrink-0 text-fg-subtle" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">No default agent yet</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Install and enable an ACP agent from Registry first.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {available.map((a) => (
              <li key={a.id}>
                <AgentRow
                  agent={a}
                  selected={defaultId === a.id}
                  enabled={isAgentEnabled(settings, a.id)}
                  waitingForAuth={waitingAuthAgentId === a.id}
                  selectedMethodId={selectedAuthMethodByAgent[a.id]}
                  activeAction={action.isPending ? action.variables ?? null : null}
                  onSetDefault={() => action.mutate({ type: "default", id: a.id })}
                  onSetEnabled={(enabled) => void setAgentEnabled(a.id, enabled)}
                  onInstall={() => action.mutate({ type: "install", id: a.id })}
                  onUpgrade={() => action.mutate({ type: "upgrade", id: a.id })}
                  onUninstall={() => action.mutate({ type: "uninstall", id: a.id })}
                  onAuth={(methodId) => action.mutate({ type: "auth", id: a.id, methodId })}
                  onProbe={() => action.mutate({ type: "probe", id: a.id })}
                  onConfigure={() => setConfiguringAgentId((id) => id === a.id ? null : a.id)}
                  onMethodIdChange={(methodId) =>
                    setSelectedAuthMethodByAgent((prev) => ({ ...prev, [a.id]: methodId }))
                  }
                />
                {settings && configuringAgentId === a.id && (
                  <CredentialPanel
                    key={a.id}
                    agent={a}
                    settings={settings}
                    onClose={() => setConfiguringAgentId(null)}
                    onSaved={() => action.mutate({ type: "probe", id: a.id })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <SectionHeading
            label="Registry"
            detail={unavailable.length > 0
              ? `${unavailable.length} installable ACP agent${unavailable.length === 1 ? "" : "s"}`
              : "Managed agent packages"}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => action.mutate({ type: "refresh" })}
            disabled={action.isPending}
            className="h-7 gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"
          >
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </div>
        {agentsLoading ? (
          <div className="flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 text-xs text-fg-muted">
            <RefreshCwIcon className="size-4 shrink-0 animate-spin text-fg-subtle" />
            Loading registry…
          </div>
        ) : unavailable.length === 0 ? (
          <div className="flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 text-xs text-fg-muted hover:bg-bg-surface/60">
            <DownloadIcon className="size-4 shrink-0 text-fg-subtle" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">Registry is empty</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                No additional ACP agents are available from the local registry.
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {unavailable.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                selected={false}
                enabled={false}
                waitingForAuth={waitingAuthAgentId === a.id}
                selectedMethodId={selectedAuthMethodByAgent[a.id]}
                activeAction={action.isPending ? action.variables ?? null : null}
                onSetDefault={() => action.mutate({ type: "default", id: a.id })}
                onSetEnabled={(enabled) => void setAgentEnabled(a.id, enabled)}
                onInstall={() => action.mutate({ type: "install", id: a.id })}
                onUpgrade={() => action.mutate({ type: "upgrade", id: a.id })}
                onUninstall={() => action.mutate({ type: "uninstall", id: a.id })}
                onAuth={(methodId) => action.mutate({ type: "auth", id: a.id, methodId })}
                onProbe={() => action.mutate({ type: "probe", id: a.id })}
                onConfigure={() => setConfiguringAgentId((id) => id === a.id ? null : a.id)}
                onMethodIdChange={(methodId) =>
                  setSelectedAuthMethodByAgent((prev) => ({ ...prev, [a.id]: methodId }))
                }
              />
            ))}
          </ul>
        )}
      </section>

      {settings && (
        <>
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading
              label="Custom agent servers"
              detail={customRows.length > 0
                ? `${customRows.length} command-backed ACP server${customRows.length === 1 ? "" : "s"}`
                : "Local commands outside the registry"}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCustomForm(emptyCustomAgentForm())}
              className="h-7 gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"
            >
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          </div>

          {customRows.length > 0 && (
            <ul className="space-y-1">
              {customRows.map((row) => (
                <li
                  key={row.id}
                  className="group/custom flex min-h-10 items-center gap-3 rounded-xl px-4 py-3 text-xs transition-colors hover:bg-bg-surface/70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-fg">{row.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{row.id}</span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-fg-subtle">
                      <span className="truncate font-mono">
                        {[row.command, ...parseDisplayArgs(row.argsText)].join(" ")}
                      </span>
                      {envNames(row.envText).length > 0 && (
                        <span className="shrink-0">
                          env {envNames(row.envText).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setCustomForm(row)}
                    className="size-7 shrink-0 text-fg-subtle opacity-70 hover:text-fg group-hover/custom:opacity-100"
                    aria-label={`Edit ${row.label}`}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => { void removeCustomAgent(row.id); }}
                    className="size-7 shrink-0 text-fg-subtle opacity-70 hover:text-danger group-hover/custom:opacity-100"
                    aria-label={`Remove ${row.label}`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {customForm && (
            <CustomAgentPanel
              value={customForm}
              onChange={setCustomForm}
              onCancel={() => setCustomForm(null)}
              onSave={() => { void saveCustomAgent(); }}
            />
          )}
        </section>

        <section>
          <SectionHeading className="mb-4" label="Prompt queue" detail="Agent loop scheduling" />
          <div className="flex items-center justify-between gap-4 rounded-xl px-4 py-3 transition-colors hover:bg-bg-surface/70">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-fg">Prompt queue</h3>
              <p className="mt-0.5 text-[11px] text-fg-muted">
                Follow-up prompts wait for the current agent loop before they start.
              </p>
            </div>
            <Checkbox
              checked={settings.default.prompt_queue_enabled}
              onCheckedChange={(checked) => { void setPromptQueueEnabled(checked === true); }}
              aria-label={`${settings.default.prompt_queue_enabled ? "Disable" : "Enable"} prompt queue`}
              className="shrink-0"
            />
          </div>
        </section>
        </>
      )}
    </div>
  );
}

function SectionHeading({
  className,
  label,
  detail,
}: {
  className?: string;
  label: string;
  detail?: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </h2>
      {detail && <p className="mt-0.5 text-[11px] text-fg-subtle">{detail}</p>}
    </div>
  );
}

function authStillBlocks(agent: AgentInfo | undefined): boolean {
  return agent?.auth?.status === "needs-auth" || agent?.auth?.status === "unknown";
}

function AgentRow({
  agent,
  selected,
  enabled,
  waitingForAuth,
  selectedMethodId,
  activeAction,
  onSetDefault,
  onSetEnabled,
  onInstall,
  onUpgrade,
  onUninstall,
  onAuth,
  onProbe,
  onConfigure,
  onMethodIdChange,
}: {
  agent: AgentInfo;
  selected: boolean;
  enabled: boolean;
  waitingForAuth: boolean;
  selectedMethodId?: string;
  activeAction: AgentAction | null;
  onSetDefault: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onInstall: () => void;
  onUpgrade: () => void;
  onUninstall: () => void;
  onAuth: (methodId?: string) => void;
  onProbe: () => void;
  onConfigure: () => void;
  onMethodIdChange: (methodId: string) => void;
}) {
  const setup = deriveAgentSetupState(agent, { waitingForAuth, selectedMethodId });
  const authMethods = agent.auth?.methods ?? [];
  const rowPending = activeAction?.id === agent.id;
  const anyPending = activeAction != null;
  const pendingLabel = rowPending ? pendingActionLabel(activeAction) : null;
  const authMethodId = setup.authMethod?.id ?? "";
  const commandText = agent.command !== agent.id ? agent.command : "";
  const canEnable = setup.canDefault;

  return (
    <div
      className={cn(
        "group/agent grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 rounded-xl px-4 py-3 text-left text-xs transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        selected ? "bg-bg-surface text-fg shadow-sm" : "text-fg hover:bg-bg-surface/70",
        !setup.available && "text-fg-subtle",
      )}
    >
      <button
        type="button"
        onClick={onSetDefault}
        disabled={!setup.canDefault}
        className="grid size-7 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-bg-surface/60 hover:text-fg disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-fg-subtle disabled:opacity-45"
        aria-label={selected ? "Default agent" : "Set as default agent"}
      >
        {selected ? (
          <CheckCircle2Icon className="size-4 text-brand" />
        ) : (
          <CircleIcon className="size-3.5" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{agent.label}</span>
          <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{agent.id}</span>
          {enabled && (
            <span className="shrink-0 rounded bg-success-subtle/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
              Enabled
            </span>
          )}
          {selected && (
            <span className="shrink-0 rounded bg-bg/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
              Default
            </span>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-fg-subtle">
          <span className={statusTextClass(setup.statusText)}>{setup.statusText}</span>
          {pendingLabel && <span className="text-fg-muted">{pendingLabel}</span>}
          {commandText && <span className="truncate font-mono">{commandText}</span>}
        </div>
      </div>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:col-span-1 sm:col-start-3">
        <label
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-fg-muted",
            canEnable ? "hover:bg-bg/50 hover:text-fg" : "opacity-45",
          )}
        >
          <Checkbox
            checked={enabled}
            disabled={!canEnable || anyPending}
            onCheckedChange={(checked) => onSetEnabled(checked === true)}
            aria-label={`${enabled ? "Disable" : "Enable"} ${agent.label}`}
          />
          Enable
        </label>
        {agent.homepage && (
          <a
            href={agent.homepage}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-fg-muted transition-colors hover:bg-bg/50 hover:text-fg"
          >
            <ExternalLinkIcon className="size-3" />
            homepage
          </a>
        )}
        {!setup.available && agent.installHint && !agent.installable && (
          <Badge variant="secondary" className="max-w-48 truncate font-mono text-[11px]">
            {agent.installHint}
          </Badge>
        )}
        {setup.authNeeded && authMethods.length > 1 && (
          <select
            value={authMethodId}
            onChange={(event) => onMethodIdChange(event.target.value)}
            disabled={anyPending}
            aria-label={`Auth method for ${agent.label}`}
            className="h-7 max-w-36 shrink-0 rounded-md border border-border/60 bg-bg/70 px-2 text-xs text-fg outline-none transition-colors hover:border-border-strong focus:border-border-strong disabled:opacity-50"
          >
            {authMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name ?? method.id}
              </option>
            ))}
          </select>
        )}
        {setup.setupAction.kind === "install" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onInstall}
            disabled={anyPending}
            className="h-7 shrink-0 gap-1.5 bg-bg/55 px-2 text-xs hover:bg-bg"
          >
            <DownloadIcon className="size-3.5" />
            {rowPending && activeAction?.type === "install" ? "Installing…" : "Install"}
          </Button>
        )}
        {setup.setupAction.kind === "upgrade" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onUpgrade}
            disabled={anyPending}
            className="h-7 shrink-0 gap-1.5 bg-bg/55 px-2 text-xs hover:bg-bg"
          >
            <UploadIcon className="size-3.5" />
            {rowPending && activeAction?.type === "upgrade" ? "Upgrading…" : "Upgrade"}
          </Button>
        )}
        {(setup.authAction.kind === "configure" || setup.authAction.kind === "sign-in" || setup.authAction.kind === "open-setup") && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={setup.authAction.kind === "configure" ? onConfigure : () => onAuth(authMethodId || undefined)}
            disabled={anyPending}
            className="h-7 shrink-0 gap-1.5 bg-bg/55 px-2 text-xs hover:bg-bg"
            aria-label={setup.authAction.ariaLabel}
          >
            <KeyRoundIcon className="size-3.5" />
            {setup.authAction.kind === "configure"
              ? setup.authAction.label
              : rowPending && activeAction?.type === "auth"
                ? "Opening…"
                : setup.authAction.label}
          </Button>
        )}
        {(setup.authAction.kind === "probe" || (setup.available && agent.auth)) && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onProbe}
            disabled={anyPending}
            className="size-7 shrink-0 text-fg-subtle hover:bg-bg/55 hover:text-fg"
            aria-label={`Check ${agent.label} auth again`}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        )}
        {agent.installed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onUninstall}
            disabled={anyPending}
            className="size-7 shrink-0 text-fg-subtle opacity-0 hover:text-danger focus:opacity-100 group-hover/agent:opacity-100"
            aria-label={`Uninstall ${agent.label}`}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function statusTextClass(statusText: string): string {
  if (statusText === "Auth needed" || statusText === "Auth unknown") return "text-danger";
  if (statusText === "Waiting for auth") return "text-brand";
  if (statusText === "Update available") return "text-fg-muted";
  return "text-fg-subtle";
}

function CredentialPanel({
  agent,
  settings,
  onClose,
  onSaved,
}: {
  agent: AgentInfo;
  settings: Settings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const method = selectedAuthMethod(agent);
  const vars = method?.vars ?? [];
  const initialValues = useMemo(() => {
    const existing = settings.agents.find((item) => item.id === agent.id);
    const env = new Map(existing?.env.map((item) => [item.name, item.value]) ?? []);
    return Object.fromEntries(vars.map((variable) => [variable.name, env.get(variable.name) ?? ""]));
  }, [agent.id, settings.agents, vars]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const save = async () => {
    await patchSettings({
      agents: upsertAgentEnv(settings, agent.id, values),
    });
    onSaved();
  };

  return (
    <div className="ml-9 mt-1 rounded-lg border border-border/35 bg-bg-surface/45 px-3 py-3 text-xs text-fg-muted">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-fg">Configure {agent.label} credentials</div>
          <p className="mt-1">
            Stored as this agent's environment override and passed only when
            Backchat starts the ACP process.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-7 px-2 text-xs">
          Close
        </Button>
      </div>
      {method?.description && <p className="mt-2">{method.description}</p>}
      <div className="mt-3 grid gap-2">
        {vars.map((variable) => (
          <label key={variable.name} className="grid gap-1">
            <span className="font-mono text-[11px] text-fg-subtle">
              {variable.name}
              {variable.optional ? " (optional)" : ""}
            </span>
            <input
              type={variable.secret === false ? "text" : "password"}
              value={values[variable.name] ?? ""}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [variable.name]: event.target.value }))
              }
              placeholder={variable.label ?? variable.name}
              className="h-8 rounded border border-border-subtle bg-bg px-2 font-mono text-xs text-fg outline-none focus:border-border"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {method?.link ? (
          <a href={method.link} className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">
            <ExternalLinkIcon className="size-3" />
            Credential source
          </a>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" onClick={save} className="h-7 px-2 text-xs">
          Save and check
        </Button>
      </div>
    </div>
  );
}

function CustomAgentPanel({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: CustomAgentFormState;
  onChange: (next: CustomAgentFormState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const inputClass = "h-7 rounded-md border border-border/60 bg-bg/80 px-2 text-xs text-fg outline-none focus:border-border-strong";
  const textareaClass = "min-h-16 rounded-md border border-border/60 bg-bg/80 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-border-strong";
  return (
    <div className="mt-3 rounded-xl border border-border/45 bg-bg/70 px-3 py-3 text-xs text-fg-muted shadow-card-soft">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-medium text-fg">ID</span>
          <input
            value={value.id}
            onChange={(event) => onChange({ ...value, id: event.target.value })}
            placeholder="studio"
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-fg">Name</span>
          <input
            value={value.label}
            onChange={(event) => onChange({ ...value, label: event.target.value })}
            placeholder="Studio ACP"
            className={inputClass}
          />
        </label>
      </div>
      <label className="mt-2 grid gap-1">
        <span className="font-medium text-fg">Command</span>
        <input
          value={value.command}
          onChange={(event) => onChange({ ...value, command: event.target.value })}
          placeholder="/usr/local/bin/studio-acp"
          className={`${inputClass} font-mono`}
        />
      </label>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-medium text-fg">Arguments</span>
          <textarea
            value={value.argsText}
            onChange={(event) => onChange({ ...value, argsText: event.target.value })}
            placeholder={"--acp\n--profile=work"}
            className={textareaClass}
          />
        </label>
        <label className="grid gap-1">
          <span className="font-medium text-fg">Environment</span>
          <textarea
            value={value.envText}
            onChange={(event) => onChange({ ...value, envText: event.target.value })}
            placeholder={"STUDIO_TOKEN=...\nOPENAI_API_KEY=..."}
            className={textareaClass}
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 px-2 text-xs">
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onSave} className="h-7 px-2 text-xs">
          Save and check
        </Button>
      </div>
    </div>
  );
}

function pendingActionLabel(action: AgentAction): string {
  switch (action.type) {
    case "install":
      return "Installing…";
    case "upgrade":
      return "Upgrading…";
    case "uninstall":
      return "Uninstalling…";
    case "auth":
      return "Opening auth…";
    case "probe":
      return "Checking auth…";
    case "refresh":
      return "Checking…";
    case "default":
      return "Setting default…";
  }
}

function emptyCustomAgentForm(): CustomAgentFormState {
  return {
    id: "",
    label: "",
    command: "",
    argsText: "--acp",
    envText: "",
  };
}

function parseDisplayArgs(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function envNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
}

function upsertAgentEnv(
  settings: Settings,
  agentId: string,
  values: Record<string, string>,
): Settings["agents"] {
  const existing = settings.agents.find((agent) => agent.id === agentId);
  const names = new Set(Object.keys(values));
  const keptEnv = (existing?.env ?? []).filter((entry) => !names.has(entry.name));
  const nextEnv = [
    ...keptEnv,
    ...Object.entries(values)
      .filter(([, value]) => value.length > 0)
      .map(([name, value]) => ({ name, value })),
  ];
  const rest = settings.agents.filter((agent) => agent.id !== agentId);
  if (
    nextEnv.length === 0 &&
    !existing?.enabled &&
    !existing?.label_override &&
    !existing?.command_override &&
    !existing?.args_override
  ) {
    return rest;
  }
  return [
    ...rest,
    {
      id: agentId,
      ...(existing?.enabled ? { enabled: true } : {}),
      ...(existing?.label_override ? { label_override: existing.label_override } : {}),
      ...(existing?.command_override ? { command_override: existing.command_override } : {}),
      ...(existing?.args_override ? { args_override: existing.args_override } : {}),
      env: nextEnv,
    },
  ];
}

function upsertAgentEnabled(
  settings: Settings,
  agentId: string,
  enabled: boolean,
): Settings["agents"] {
  const existing = settings.agents.find((agent) => agent.id === agentId);
  const rest = settings.agents.filter((agent) => agent.id !== agentId);
  if (
    !enabled &&
    !existing?.label_override &&
    !existing?.command_override &&
    !existing?.args_override &&
    (existing?.env ?? []).length === 0
  ) {
    return rest;
  }
  return [
    ...rest,
    {
      id: agentId,
      ...(enabled ? { enabled: true } : {}),
      ...(existing?.label_override ? { label_override: existing.label_override } : {}),
      ...(existing?.command_override ? { command_override: existing.command_override } : {}),
      ...(existing?.args_override ? { args_override: existing.args_override } : {}),
      env: existing?.env ?? [],
    },
  ];
}
