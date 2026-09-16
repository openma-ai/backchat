import { openmaTargets } from "@/lib/openma-targets";
import { CheckIcon, ChevronDownIcon, CloudIcon, MonitorIcon, ServerIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useOpenmaAccount, useOpenmaCatalog } from "@/lib/openma-account";
import { sessionStore, useSessionStore, selectActive, type SessionRow } from "@/lib/session-store";
import type { OpenmaExecutionTarget } from "@shared/openma";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function RuntimeLocationControl({ title, className, session }: { title?: string; className?: string; session?: SessionRow }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const active = useSessionStore(selectActive);
  const row = session ?? active;
  const target = row?.executionTarget;
  const locked = !!row && row.status !== "draft";
  const { data: account } = useOpenmaAccount();
  const scope = target ?? (account?.user && account.activeWorkspaceId ? { baseUrl: account.baseUrl, userId: account.user.id, workspaceId: account.activeWorkspaceId } : undefined);
  const { data: catalog, isFetching, error, refetch } = useOpenmaCatalog(scope);
  const choices = scope && catalog ? openmaTargets(scope, catalog) : [];
  const Icon = target?.kind === "cloud" ? CloudIcon : target ? ServerIcon : MonitorIcon;
  const select = (next: OpenmaExecutionTarget | undefined) => { if (row && !locked) sessionStore.setExecutionTarget(row.id, next); };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open && account?.status === "signed_in") void refetch(); }}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" data-composer-footer-control="runtime" data-session-runtime-location="true" className={cn("app-compact-control runtime-location-control min-w-0 bg-transparent", className)} title={title ?? t("chat.whereRuns")}>
          <span data-control-icon><Icon /></span>
          <span className="truncate">{target ? `${target.runtimeName} · ${target.environmentName}` : t("chat.local")}</span>
          <ChevronDownIcon data-control-chevron />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[var(--composer-menu-width)] max-h-[60vh] overflow-y-auto">
        <DropdownMenuItem onSelect={() => void navigate({ to: "/settings/openma" })}>{t(account?.status === "signed_in" ? "openma.account" : "openma.signIn")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {locked ? <DropdownMenuLabel className="text-xs font-normal">{t("openma.fixedLocation")}</DropdownMenuLabel> : !target ? (
          <DropdownMenuItem onSelect={() => select(undefined)} className="flex items-center gap-2 text-xs">
            <MonitorIcon className="size-3.5" /><span className="flex-1">{t("chat.local")}</span>{!target && <CheckIcon className="size-3.5" />}
          </DropdownMenuItem>
        ) : null}
        {!locked && choices.map(({ target: choice, offline }) => (
          <DropdownMenuItem key={`${choice.environmentId}:${choice.agentId}`} disabled={offline} onSelect={() => select(choice)} className="flex items-start gap-2 text-xs">
            {choice.kind === "cloud" ? <CloudIcon className="mt-0.5 size-3.5" /> : <ServerIcon className="mt-0.5 size-3.5" />}
            <div className="min-w-0 flex-1"><div>{choice.runtimeName} · {choice.environmentName}</div><div className="text-fg-subtle">{choice.agentName}{offline ? ` · ${t("openma.offline")}` : ""}</div></div>
            {choice.agentId === target?.agentId && choice.environmentId === target.environmentId && <CheckIcon className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        {!locked && account?.status === "signed_in" && !choices.length && <DropdownMenuLabel className="text-xs font-normal">{isFetching ? t("openma.loadingLocations") : error ? t("openma.locationsUnavailable") : t("openma.noLocations")}</DropdownMenuLabel>}
        {account?.status === "signed_in" && <DropdownMenuItem onSelect={() => void window.backchat.openmaOpenManagement()}>{t("openma.manageResources")}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
