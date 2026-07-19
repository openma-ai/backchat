import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CpuIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusNotice } from "@/components/ui/status-notice";
import { useSettings, patchSettings } from "@/lib/settings-store";
import { isAgentEnabled } from "@/lib/enabled-agents";
import type { AgentInfo } from "@shared/api";
import type { Settings } from "@shared/settings";
import { deriveAgentSetupState } from "./agent-setup-lifecycle";
import {
  customAgentRows,
  parseCustomAgentArgs,
  parseCustomAgentEnv,
  removeCustomAgentServer,
  upsertAgentEnabled,
  upsertCustomAgentServer,
  type CustomAgentFormState,
} from "./custom-agent-settings";
import {
  AgentAuthSetupPanel,
  CustomAgentPanel,
} from "./AgentSettingsPanels";
import {
  agentActionKey,
  sortAgentsByInstalling,
  type AgentAction,
} from "./agent-action-state";
import { AgentRow } from "./AgentSettingsRow";

// Downloads may run concurrently, but each completed install updates the same
// settings array. Serialize just that tiny merge so two completions cannot
// overwrite one another with stale renderer snapshots.
let installEnableTail: Promise<void> = Promise.resolve();

function enableInstalledAgent(agentId: string): Promise<void> {
  const update = installEnableTail.then(async () => {
    const latest = await window.backchat.settingsGet();
    await patchSettings({
      agents: upsertAgentEnabled(latest, agentId, true),
    });
  });
  installEnableTail = update.catch(() => undefined);
  return update;
}

/**
 * Settings → Agents.
 *
 * Registry-managed installs, upgrades, authentication, and credential env
 * overrides stay on this page so setup is one flow. New chats restore the
 * most recently used runnable agent rather than a static configured default.
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
  const [pendingActions, setPendingActions] = useState<AgentAction[]>([]);
  const { data: agents = [], isLoading: agentsLoading, error: agentsError } = useQuery({
    queryKey: ["agents", "setup"],
    queryFn: () => window.backchat.agentsList({ readiness: "snapshot" }),
  });
  useEffect(() => {
    let cancelled = false;
    void window.backchat.agentsList().then((readyAgents) => {
      if (cancelled) return;
      queryClient.setQueryData(["agents", "setup"], readyAgents);
      queryClient.setQueryData(["agents"], readyAgents);
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);
  const action = useMutation({
    mutationFn: async (input: AgentAction) => {
      if (input.type === "install" && input.id) {
        const next = await window.backchat.agentInstall(input.id);
        const installed = next.find((item) => item.id === input.id);
        if (installed && deriveAgentSetupState(installed).canEnable) {
          await enableInstalledAgent(input.id);
        }
        return next;
      }
      if (input.type === "upgrade" && input.id) return window.backchat.agentUpgrade(input.id);
      if (input.type === "uninstall" && input.id) return window.backchat.agentUninstall(input.id);
      if (input.type === "auth" && input.id) {
        return window.backchat.agentAuthenticate({ id: input.id, methodId: input.methodId });
      }
      if (input.type === "refresh") {
        return window.backchat.agentsList({ refresh: true });
      }
      return window.backchat.agentsList();
    },
    onMutate: (variables) => {
      const key = agentActionKey(variables);
      setPendingActions((current) => [
        ...current.filter((item) => agentActionKey(item) !== key),
        variables,
      ]);
    },
    onSuccess: (next, variables) => {
      queryClient.setQueryData(["agents", "setup"], next);
      queryClient.setQueryData(["agents"], next);
      if (variables.type === "auth" && variables.id) {
        const agent = next.find((item) => item.id === variables.id);
        setWaitingAuthAgentId(agent?.auth?.status === "configured" ? null : variables.id);
      } else if (variables.type === "install" || variables.type === "uninstall" || variables.type === "upgrade") {
        setWaitingAuthAgentId(null);
      }
    },
    onSettled: (_data, _error, variables) => {
      const key = agentActionKey(variables);
      setPendingActions((current) =>
        current.filter((item) => agentActionKey(item) !== key),
      );
    },
  });

  const available = agents.filter((a) => a.available ?? a.detected);
  const installingAgentIds = new Set(
    pendingActions.flatMap((item) =>
      item.type === "install" && item.id ? [item.id] : [],
    ),
  );
  const unavailable = sortAgentsByInstalling(
    agents.filter((a) => !(a.available ?? a.detected)),
    installingAgentIds,
  );
  const customRows = settings ? customAgentRows(settings) : [];

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
              Enable the ACP agents you want available. New chats restore the
              agent and model configuration you used most recently.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => action.mutate({ type: "refresh" })}
            disabled={pendingActions.length > 0}
            className="h-7 gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"
          >
            <RefreshCwIcon className="size-3.5" />
            {pendingActions.some((item) => item.type === "refresh") ? "Checking…" : "Check again"}
          </Button>
        </div>
        {action.error && (
          <StatusNotice tone="danger" className="mt-2">
            {action.error instanceof Error ? action.error.message : String(action.error)}
          </StatusNotice>
        )}
        {agentsError && (
          <StatusNotice tone="danger" className="mt-2">
            {agentsError instanceof Error ? agentsError.message : String(agentsError)}
          </StatusNotice>
        )}
      </header>

      <section>
        <SectionHeading className="mb-4" label="Available agents" detail={`${available.length} available`} />
        {agentsLoading ? (
          <div className="flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 text-xs text-fg-muted">
            <RefreshCwIcon className="size-4 shrink-0 animate-spin text-fg-subtle" />
            Loading agents…
          </div>
        ) : available.length === 0 ? (
          <div className="flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 text-xs text-fg-muted hover:bg-bg-surface/60">
            <CpuIcon className="size-4 shrink-0 text-fg-subtle" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">No agent available</p>
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
                  enabled={isAgentEnabled(settings, a.id)}
                  waitingForAuth={waitingAuthAgentId === a.id}
                  selectedMethodId={selectedAuthMethodByAgent[a.id]}
                  activeActions={pendingActions}
                  onSetEnabled={(enabled) => void setAgentEnabled(a.id, enabled)}
                  onInstall={() => action.mutate({ type: "install", id: a.id })}
                  onUpgrade={() => action.mutate({ type: "upgrade", id: a.id })}
                  onUninstall={() => action.mutate({ type: "uninstall", id: a.id })}
                  onOpenSetup={() => setConfiguringAgentId((id) => id === a.id ? null : a.id)}
                />
                {settings && configuringAgentId === a.id && (
                  <AgentAuthSetupPanel
                    key={`${a.id}:${selectedAuthMethodByAgent[a.id] ?? a.auth?.methodId ?? ""}`}
                    agent={a}
                    settings={settings}
                    selectedMethodId={selectedAuthMethodByAgent[a.id]}
                    waitingForAuth={waitingAuthAgentId === a.id}
                    pending={pendingActions.some((item) => item.id === a.id)}
                    onMethodIdChange={(methodId) =>
                      setSelectedAuthMethodByAgent((prev) => ({ ...prev, [a.id]: methodId }))
                    }
                    onStart={(methodId) => action.mutate({ type: "auth", id: a.id, methodId })}
                    onClose={() => setConfiguringAgentId(null)}
                    onSaved={() => setConfiguringAgentId(null)}
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
            disabled={pendingActions.length > 0}
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
                enabled={false}
                waitingForAuth={waitingAuthAgentId === a.id}
                selectedMethodId={selectedAuthMethodByAgent[a.id]}
                activeActions={pendingActions}
                onSetEnabled={(enabled) => void setAgentEnabled(a.id, enabled)}
                onInstall={() => action.mutate({ type: "install", id: a.id })}
                onUpgrade={() => action.mutate({ type: "upgrade", id: a.id })}
                onUninstall={() => action.mutate({ type: "uninstall", id: a.id })}
                onOpenSetup={() => setConfiguringAgentId((id) => id === a.id ? null : a.id)}
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
                        {[row.command, ...parseCustomAgentArgs(row.argsText)].join(" ")}
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

function emptyCustomAgentForm(): CustomAgentFormState {
  return {
    id: "",
    label: "",
    command: "",
    argsText: "--acp",
    envText: "",
  };
}

function envNames(text: string): string[] {
  return parseCustomAgentEnv(text).map((entry) => entry.name);
}
