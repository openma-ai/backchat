import {
  ArchiveIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  selectActive,
  sessionStore,
  useSessionStore,
} from "@/lib/session-store";
import type { SessionRow } from "@/lib/session-store";
import { AgentIcon } from "@/components/AgentIcon";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

/**
 * Single-chat chrome is deliberately sparse: task title + one actions
 * select. Runtime, project, mode and usage are session/composer state,
 * not part of the task's identity.
 */
export function Topbar(_props: { onCancel: () => void }) {
  void _props;
  const active = useSessionStore(selectActive);
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const isChat = location.pathname.startsWith("/chat/");
  if (!active || !isChat) return null;

  const pinned = active.pinnedAt != null;
  const canOpenSideChat =
    active.status !== "draft" && active.sideKind !== "subagent";

  const openSideChat = async () => {
    if (!canOpenSideChat) return;
    const cwd = active.cwd || (await window.backchat.uiFsHome());
    const canFork =
      !!active.supportsSessionFork && !!active.acp_session_id;
    const sideId = sessionStore.newSideDraft({
      parentSessionId: active.id,
      parentAcpSessionId: canFork ? active.acp_session_id : undefined,
      inheritance: canFork ? "fork" : "fresh",
      agentId: active.agent_id,
      cwd,
    });
    sessionStore.openSideTab("chat", sideId, t("sideChat.title"));
  };

  const archive = () => {
    sessionStore.archive(active.id);
    sessionStore.setActive(null);
    void navigate({ to: "/" });
  };

  return (
    <div className="app-no-drag flex min-w-0 items-center gap-1.5 text-sm">
      <span className="max-w-[min(42vw,32rem)] truncate font-medium text-fg">
        {active.label || t("sidebar.newChat")}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("topbar.taskActions")}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
              "text-fg-subtle transition-colors",
              "hover:bg-bg-surface hover:text-fg",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="min-w-[164px]">
          <DropdownMenuItem
            onSelect={() => (
              pinned
                ? sessionStore.unpin(active.id)
                : sessionStore.pin(active.id)
            )}
          >
            {pinned
              ? <PinOffIcon className="size-3.5" />
              : <PinIcon className="size-3.5" />}
            <span>{pinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
          </DropdownMenuItem>
          {canOpenSideChat && (
            <DropdownMenuItem onSelect={() => void openSideChat()}>
              <MessageSquarePlusIcon className="size-3.5" />
              <span>{t("topbar.openSideChat")}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={archive}>
            <ArchiveIcon className="size-3.5" />
            <span>{t("sidebar.archive")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PairTopbar() {
  const location = useLocation();
  const pairId = location.pathname.startsWith("/pair/")
    ? decodeURIComponent(location.pathname.slice("/pair/".length))
    : "";
  const members: SessionRow[] = useSessionStore(
    useMemo(
      () => (st: ReturnType<typeof useSessionStore<unknown>> extends never ? never : any) => {
        if (!pairId) return [] as SessionRow[];
        const pair = st.pair(pairId);
        if (!pair) return [] as SessionRow[];
        return pair.members
          .map((id: string) => st.get(id))
          .filter((m: SessionRow | null): m is SessionRow => !!m);
      },
      [pairId],
    ),
  );

  if (members.length === 0) return null;

  const gridClass =
    members.length <= 2
      ? "grid-cols-2"
      : members.length <= 4
        ? "grid-cols-2 grid-rows-2"
        : "grid-cols-3";

  return (
    <div
      className={cn(
        "pointer-events-none grid h-full w-full min-w-0 text-fg-muted",
        gridClass,
      )}
    >
      {members.map((m, index) => (
        <div
          key={m.id}
          aria-hidden="true"
          className={cn(
            "flex h-full items-center px-4",
            index > 0 && "border-l border-border/60",
          )}
        >
          <AgentIcon agentId={m.agent_id} className="size-4 shrink-0" />
        </div>
      ))}
    </div>
  );
}
