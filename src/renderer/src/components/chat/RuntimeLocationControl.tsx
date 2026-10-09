import { openmaWorkspaceScope } from "@shared/openma";
import { openmaTargets } from "@/lib/openma-targets";
import {
  ChevronDownIcon,
  CloudIcon,
  MonitorIcon,
  ServerIcon,
} from "@/components/Icons";
import { useNavigate } from "@tanstack/react-router";
import { useOpenmaAccount, useOpenmaCatalog } from "@/lib/openma-account";
import {
  sessionStore,
  useSessionStore,
  selectActive,
  type SessionRow,
} from "@/lib/session-store";
import type { OpenmaExecutionTarget } from "@shared/openma";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GroupedCommandMenu,
  groupedCommandMenuDropdownShellClassName,
  groupedCommandMenuPresets,
} from "@/components/ui/grouped-command-menu";
import {
  GroupedCommandMenuIconSlot,
  GroupedCommandMenuLabelSlot,
} from "@/components/ui/grouped-command-menu-slots";
import { composerFooterTriggerClass } from "@/components/ui/composer-footer-trigger";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import type {
  GroupedCommandMenuGroup,
  GroupedCommandMenuItem,
} from "@/components/ui/grouped-command-menu";

export function RuntimeLocationControl({
  title,
  className,
  session,
}: {
  title?: string;
  className?: string;
  session?: SessionRow;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const active = useSessionStore(selectActive);
  const row = session ?? active;
  const target = row?.executionTarget;
  const locked = !!row && row.status !== "draft";
  const { data: account } = useOpenmaAccount();
  const scope =
    target ??
    (account?.user && account.activeWorkspaceId
      ? openmaWorkspaceScope(account, account.activeWorkspaceId)
      : undefined);
  const { data: catalog, isFetching, error, refetch } = useOpenmaCatalog(scope);
  const choices = scope && catalog ? openmaTargets(scope, catalog) : [];
  const Icon = target?.kind === "cloud" ? CloudIcon : target ? ServerIcon : MonitorIcon;
  const [menuOpen, setMenuOpen] = useState(false);

  const select = (next: OpenmaExecutionTarget | undefined) => {
    if (!row || locked) return;
    if (!next) {
      sessionStore.setExecutionTarget(row.id, undefined);
      return;
    }
    const provider = account?.workspaces.find(
      (workspace) => workspace.id === next.workspaceId,
    )?.provider;
    const sourcePath = row.chosenCwd || row.cwd || undefined;
    sessionStore.setExecutionTarget(
      row.id,
      provider === "cursor-cloud"
        ? {
            ...next,
            cursor: { ...next.cursor, ...(sourcePath ? { sourcePath } : {}) },
          }
        : next,
    );
  };

  const groups = useMemo((): GroupedCommandMenuGroup[] => {
    const locationItems: GroupedCommandMenuItem[] = [];

    if (!locked && !target) {
      locationItems.push({
        id: "local",
        value: t("chat.local"),
        checked: true,
        onSelect: () => select(undefined),
        children: (
          <>
            <GroupedCommandMenuIconSlot>
              <MonitorIcon />
            </GroupedCommandMenuIconSlot>
            <GroupedCommandMenuLabelSlot>
              <span className="truncate">{t("chat.local")}</span>
            </GroupedCommandMenuLabelSlot>
          </>
        ),
      });
    }

    if (!locked) {
      for (const { target: choice, offline } of choices) {
        const checked =
          choice.agentId === target?.agentId &&
          choice.environmentId === target.environmentId;
        locationItems.push({
          id: `${choice.environmentId}:${choice.agentId}`,
          value: `${choice.runtimeName} ${choice.environmentName} ${choice.agentName}`,
          disabled: offline,
          checked,
          onSelect: () => select(choice),
          children: (
            <>
              <GroupedCommandMenuIconSlot>
                {choice.kind === "cloud" ? <CloudIcon /> : <ServerIcon />}
              </GroupedCommandMenuIconSlot>
              <GroupedCommandMenuLabelSlot>
                <span className="truncate">
                  {choice.runtimeName} · {choice.environmentName}
                </span>
                <span className="text-fg-subtle">
                  {choice.agentName}
                  {offline ? ` · ${t("openma.offline")}` : ""}
                </span>
              </GroupedCommandMenuLabelSlot>
            </>
          ),
        });
      }
    }

    const accountItems: GroupedCommandMenuItem[] = [
      {
        id: "openma-account",
        value: "openma-account",
        onSelect: () => void navigate({ to: "/settings/openma" }),
        children: (
          <>
            <GroupedCommandMenuIconSlot>
              <span className="size-3.5" aria-hidden />
            </GroupedCommandMenuIconSlot>
            <GroupedCommandMenuLabelSlot>
              <span className="truncate">
                {t(account?.status === "signed_in" ? "openma.account" : "openma.signIn")}
              </span>
            </GroupedCommandMenuLabelSlot>
          </>
        ),
      },
    ];

    const tailItems: GroupedCommandMenuItem[] = [];
    if (!locked && account?.status === "signed_in" && !choices.length) {
      tailItems.push({
        id: "locations-status",
        value: "locations-status",
        disabled: true,
        onSelect: () => {},
        children: (
          <>
            <GroupedCommandMenuIconSlot>
              <span className="size-3.5" aria-hidden />
            </GroupedCommandMenuIconSlot>
            <GroupedCommandMenuLabelSlot>
              <span className="text-fg-subtle">
                {isFetching
                  ? t("openma.loadingLocations")
                  : error
                    ? t("openma.locationsUnavailable")
                    : t("openma.noLocations")}
              </span>
            </GroupedCommandMenuLabelSlot>
          </>
        ),
      });
    }
    if (account?.status === "signed_in") {
      tailItems.push({
        id: "openma-manage",
        value: "openma-manage",
        onSelect: () => void window.backchat.openmaOpenManagement(),
        children: (
          <>
            <GroupedCommandMenuIconSlot>
              <span className="size-3.5" aria-hidden />
            </GroupedCommandMenuIconSlot>
            <GroupedCommandMenuLabelSlot>
              <span className="truncate">{t("openma.manageResources")}</span>
            </GroupedCommandMenuLabelSlot>
          </>
        ),
      });
    }

    const result: GroupedCommandMenuGroup[] = [{ items: accountItems }];
    if (locked) {
      result.push({
        heading: t("openma.fixedLocation"),
        items: [],
      });
    } else if (locationItems.length > 0) {
      result.push({ items: locationItems });
    }
    if (tailItems.length > 0) {
      result.push({ items: tailItems });
    }
    return result;
  }, [
    account?.status,
    choices,
    error,
    isFetching,
    locked,
    navigate,
    t,
    target,
  ]);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open && account?.status === "signed_in") void refetch();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-composer-footer-control="runtime"
          data-session-runtime-location="true"
          className={cn(composerFooterTriggerClass("runtime-location-control"), className)}
          title={title ?? t("chat.whereRuns")}
        >
          <span data-control-icon>
            <Icon />
          </span>
          <span className="truncate">
            {target ? `${target.runtimeName} · ${target.environmentName}` : t("chat.local")}
          </span>
          <ChevronDownIcon data-control-chevron />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={0}
        className={groupedCommandMenuDropdownShellClassName()}
      >
        <GroupedCommandMenu
          testId="composer-host-picker-panel"
          menuMode="host-picker"
          menuResetKey={menuOpen ? "open" : "closed"}
          showSearch={false}
          autoFocus={false}
          searchPlaceholder=""
          emptyMessage=""
          insideDropdownMenu
          listHeightPx={groupedCommandMenuPresets.footer.listHeightPx}
          panelHeightPx={groupedCommandMenuPresets.footer.panelHeightPx}
          commandClassName="rounded-xl! bg-popover text-popover-foreground shadow-none ring-0"
          groups={groups}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
