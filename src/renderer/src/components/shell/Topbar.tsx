import {
  ArchiveIcon,
  CircleStopIcon,
  MoreHorizontalIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useMemo } from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { RenameDialog } from "./RenameDialog";
import { SessionRuntimeUpdateControl } from "@/components/chat/SessionRuntimeUpdateControl";

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
  const [renameOpen, setRenameOpen] = useState(false);
  const isChat = location.pathname.startsWith("/chat/");
  if (!active || !isChat) return null;

  const pinned = active.pinnedAt != null;
  const archive = () => {
    sessionStore.archive(active.id);
    sessionStore.setActive(null);
    void navigate({ to: "/" });
  };

  const closeSession = async () => {
    try {
      await window.backchat.sessionClose({ session_id: active.id });
    } catch (error) {
      toast.error(t("topbar.endSessionFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="app-no-drag flex min-w-0 items-center gap-1.5 text-sm">
      <span className="max-w-[min(42vw,32rem)] truncate font-medium text-fg">
        {active.label || t("sidebar.newChat")}
      </span>
      {active.status !== "draft" && (
        <SessionRuntimeUpdateControl sessionId={active.id} />
      )}
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
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <span>{t("sidebar.rename")}</span>
          </DropdownMenuItem>
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
          <DropdownMenuSeparator />
          {active.supportsSessionClose && active.status !== "disposed" && (
            <DropdownMenuItem
              onSelect={() => void closeSession()}
              className="text-danger focus:text-danger"
            >
              <CircleStopIcon className="size-3.5" />
              <span>{t("topbar.endSession")}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={archive}>
            <ArchiveIcon className="size-3.5" />
            <span>{t("sidebar.archive")}</span>
          </DropdownMenuItem>
         </DropdownMenuContent>
       </DropdownMenu>
       <RenameDialog
         open={renameOpen}
         currentTitle={active.label}
         onOpenChange={setRenameOpen}
         onRename={(title) => sessionStore.rename(active.id, title)}
       />
     </div>
  );
}

export function PairTopbar() {
  const location = useLocation();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.backchat.agentsList(),
    staleTime: 60_000,
  });
  const agentIconUrls = useMemo(
    () => new Map(agents.flatMap((agent) => agent.icon ? [[agent.id, agent.icon] as const] : [])),
    [agents],
  );
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
          <AgentIcon agentId={m.agent_id} iconUrl={agentIconUrls.get(m.agent_id)} className="size-4 shrink-0" />
        </div>
      ))}
    </div>
  );
}
