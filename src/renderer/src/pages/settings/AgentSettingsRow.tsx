import {
  DownloadIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import type { AgentInfo } from "@shared/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { deriveAgentSetupState } from "./agent-setup-lifecycle";
import {
  isInstallActionDisabled,
  type AgentAction,
} from "./agent-action-state";

export function AgentRow({
  agent,
  enabled,
  waitingForAuth,
  selectedMethodId,
  activeActions,
  onSetEnabled,
  onInstall,
  onUpgrade,
  onUninstall,
  onOpenSetup,
}: {
  agent: AgentInfo;
  enabled: boolean;
  waitingForAuth: boolean;
  selectedMethodId?: string;
  activeActions: readonly AgentAction[];
  onSetEnabled: (enabled: boolean) => void;
  onInstall: () => void;
  onUpgrade: () => void;
  onUninstall: () => void;
  onOpenSetup: () => void;
}) {
  const setup = deriveAgentSetupState(agent, { waitingForAuth, selectedMethodId });
  const activeAction = activeActions.find((item) => item.id === agent.id) ?? null;
  const rowPending = activeAction != null;
  const anyPending = activeActions.length > 0;
  const pendingLabel = rowPending ? pendingActionLabel(activeAction) : null;
  const commandText = agent.command !== agent.id ? agent.command : "";
  const canEnable = setup.canEnable;

  return (
    <div
      className={cn(
        "group/agent grid min-h-11 w-full grid-cols-[minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 rounded-xl px-4 py-3 text-left text-xs text-fg transition-colors hover:bg-bg-surface/70 sm:grid-cols-[minmax(0,1fr)_auto]",
        !setup.available && "text-fg-subtle",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{agent.label}</span>
          <span className="shrink-0 font-mono text-[11px] text-fg-subtle">{agent.id}</span>
          {enabled && (
            <span className="shrink-0 rounded bg-success-subtle/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-success">
              Enabled
            </span>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-fg-subtle">
          <span className={statusTextClass(setup.statusText)}>{setup.statusText}</span>
          {pendingLabel && <span className="text-fg-muted">{pendingLabel}</span>}
          {commandText && <span className="truncate font-mono">{commandText}</span>}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:col-start-2">
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
        {setup.setupAction.kind === "install" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onInstall}
            disabled={isInstallActionDisabled(agent.id, activeActions)}
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
            onClick={onOpenSetup}
            disabled={anyPending}
            className="h-7 shrink-0 gap-1.5 bg-bg/55 px-2 text-xs hover:bg-bg"
            aria-label={setup.authAction.ariaLabel}
          >
            <KeyRoundIcon className="size-3.5" />
            {rowPending && activeAction?.type === "auth" ? "Opening…" : setup.authAction.label}
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
    case "refresh":
      return "Checking…";
  }
}
