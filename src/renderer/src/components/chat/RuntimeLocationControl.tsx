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
  groupedCommandMenuShellClassName,
} from "@/components/ui/grouped-command-menu";

/** Match main native host menu list budget (`max-h-[60vh]`). */
const HOST_PICKER_LIST_MAX_HEIGHT_PX = 540;
import {
  GroupedCommandMenuIconSlot,
  GroupedCommandMenuLabelSlot,
} from "@/components/ui/grouped-command-menu-slots";
import { composerFooterTriggerClass } from "@/components/ui/composer-footer-trigger";
import { useComposerPickerUpwardSideOffset } from "@/components/ui/use-composer-picker-upward-side-offset";
import {
  SidebarGridCell,
  SidebarGridRow,
} from "@/components/shell/SidebarGridRow";
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
  variant = "composer",
  labelCls,
}: {
  title?: string;
  className?: string;
  session?: SessionRow;
  variant?: "composer" | "sidebar";
  labelCls?: string;
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
  const upwardPickerSideOffset = useComposerPickerUpwardSideOffset();

  const applySelection = (next: OpenmaExecutionTarget | undefined) => {
    select(next);
    setMenuOpen(false);
  };

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
        onSelect: () => applySelection(undefined),
        children: (
          <>
            <GroupedCommandMenuIconSlot>
              <MonitorIcon />
            </GroupedCommandMenuIconSlot>
            <GroupedCommandMenuLabelSlot>
              <div className="truncate leading-4">{t("chat.local")}</div>
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
          onSelect: () => applySelection(choice),
          children: (
            <>
              <GroupedCommandMenuIconSlot>
                {choice.kind === "cloud" ? <CloudIcon /> : <ServerIcon />}
              </GroupedCommandMenuIconSlot>
              <GroupedCommandMenuLabelSlot>
                <div className="truncate leading-4">
                  {choice.runtimeName} · {choice.environmentName}
                </div>
                <div className="truncate leading-4 text-fg-subtle">
                  {choice.agentName}
                  {offline ? ` · ${t("openma.offline")}` : ""}
                </div>
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
        onSelect: () => {
          setMenuOpen(false);
          void navigate({ to: "/settings/openma" });
        },
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
        onSelect: () => {
          setMenuOpen(false);
          void window.backchat.openmaOpenManagement();
        },
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
      result.push({ separatorBefore: true, items: locationItems });
    }
    if (tailItems.length > 0) {
      result.push({
        // One separator after the account row only (location block or tail, never both).
        separatorBefore:
          accountItems.length > 0 && locationItems.length === 0,
        items: tailItems,
      });
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

  const locationLabel = target
    ? `${target.runtimeName} · ${target.environmentName}`
    : t("chat.local");

  const hostPickerItemCount = useMemo(
    () => groups.reduce((total, group) => total + group.items.length, 0),
    [groups],
  );
  const shrinkHostPicker = hostPickerItemCount <= 8;

  const menu = (
    <GroupedCommandMenu
      testId={
        variant === "sidebar"
          ? "sidebar-host-picker-panel"
          : "composer-host-picker-panel"
      }
      menuMode="host-picker"
      menuResetKey={menuOpen ? "open" : "closed"}
      showSearch={false}
      autoFocus={false}
      searchPlaceholder=""
      emptyMessage=""
      insideDropdownMenu
      shrinkToContent={shrinkHostPicker}
      nativeListScroll
      listClassName="host-picker-command-list"
      panelClassName="host-picker-panel flex h-auto w-full flex-col overflow-visible"
      listHeightPx={HOST_PICKER_LIST_MAX_HEIGHT_PX}
      commandClassName="rounded-xl! bg-popover p-[5px]! text-popover-foreground shadow-none ring-0"
      groups={groups}
    />
  );

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open && account?.status === "signed_in") void refetch();
      }}
    >
      <DropdownMenuTrigger asChild>
        {variant === "sidebar" ? (
          <SidebarGridRow
            depth={0}
            trailingTrack="single"
            data-sidebar-local-runtime="true"
            data-testid="sidebar-local-runtime-row"
            data-session-runtime-location="true"
            title={title ?? t("chat.whereRuns")}
            className={cn(
              "app-no-drag cursor-pointer rounded-md text-ui text-fg transition-colors",
              "hover:bg-[var(--control-bg-hover)] focus-visible:bg-[var(--control-bg-hover)]",
              "data-[state=open]:bg-[var(--control-bg-hover)]",
              className,
            )}
          >
            <SidebarGridCell slot="icon">
              <span className="sidebar-row-icon">
                <Icon className="size-3.5" />
              </span>
            </SidebarGridCell>
            <SidebarGridCell slot="label">
              <span className={cn("min-w-0 truncate", labelCls)}>{locationLabel}</span>
            </SidebarGridCell>
            <SidebarGridCell slot="trailing" aria-hidden="true">
              <ChevronDownIcon className="size-3 text-fg-subtle" />
            </SidebarGridCell>
          </SidebarGridRow>
        ) : (
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
            <span className="truncate">{locationLabel}</span>
            <ChevronDownIcon data-control-chevron />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={variant === "sidebar" ? "bottom" : "top"}
        align="start"
        sideOffset={variant === "sidebar" ? 4 : upwardPickerSideOffset}
        className={cn(
          groupedCommandMenuShellClassName(),
          "h-auto max-h-[60vh] min-w-[var(--composer-menu-width)] w-[var(--composer-menu-width)] gap-0 overflow-x-hidden overflow-y-auto bg-transparent p-0 shadow-none ring-0 oma-scrollbar",
        )}
      >
        {menu}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
