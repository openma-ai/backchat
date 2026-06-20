import { CheckIcon, CloudIcon, FolderIcon, MonitorIcon } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { selectActive, useSessionStore } from "@/lib/session-store";
import type { SessionRow } from "@/lib/session-store";
import { AgentIcon } from "@/components/AgentIcon";
import { cn } from "@/lib/utils";

/**
 * Topbar — drag region on the main region's top stage row.
 *
 *   [folder] [session label] · [cwd?] [runtime] [mode?]
 *
 * No Cancel button — composer's Stop button (right side of the input
 * when running) is the single cancel affordance. The sidebar toggle
 * lives globally in AppShell (absolute-positioned next to trafficLight).
 *
 * Empty when no session is active (home) OR when the user is on a
 * route that has its own chrome (settings) — the chat-specific chips
 * read as noise once you've navigated away from the chat surface.
 */
export function Topbar(_props: { onCancel: () => void }) {
  void _props;
  const active = useSessionStore(selectActive);
  const location = useLocation();
  const isChat = location.pathname.startsWith("/chat/");
  if (!active || !isChat) return null;

  return (
    <div className="flex w-full items-center gap-2 text-sm">
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-2 text-fg-muted">
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate text-fg">{active.label}</span>
        <CwdChip cwd={active.cwd} />
        <RuntimeChip />
        <ModeChip modeId={active.currentModeId} />
      </div>
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

/** Runtime location — Local now, Cloud once openma backend wiring lands.
 *  Always visible in topbar so the user can confirm where this turn will
 *  execute. Cloud is disabled with a "Coming soon" hint. */
function RuntimeChip() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "app-no-drag inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
          "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg-muted",
          "focus:outline-none focus:bg-bg-surface/60",
          "transition-colors",
        )}
        title="Where this conversation runs"
      >
        <MonitorIcon className="size-3" />
        <span>Local</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[200px]">
        <DropdownMenuItem className="flex items-center gap-2 text-xs">
          <MonitorIcon className="size-3.5 text-fg-subtle" />
          <span className="flex-1">Local</span>
          <CheckIcon className="size-3.5 text-fg-muted" />
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled
          className="flex items-start gap-2 text-xs opacity-60"
        >
          <CloudIcon className="mt-0.5 size-3.5 text-fg-subtle" />
          <div className="min-w-0 flex-1">
            <div>Cloud</div>
            <div className="text-[11px] text-fg-subtle">Coming soon</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Read-only workspace label — surfaces the cwd the ACP child actually
 *  spawned into so the user can confirm "this conversation is rooted
 *  here". Hidden when the session hasn't reached `ready` yet (cwd is
 *  empty string until session.ready lands). Click opens the dir in
 *  the OS file browser. */
function CwdChip({ cwd }: { cwd: string }) {
  if (!cwd) return null;
  const short = shortCwd(cwd);
  return (
    <button
      type="button"
      onClick={() => {
        void window.backchat.uiFsOpenPath({ path: cwd });
      }}
      title={cwd}
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px]",
        "text-fg-subtle hover:bg-bg-surface/60 hover:text-fg-muted",
        "transition-colors",
      )}
    >
      {short}
    </button>
  );
}

function shortCwd(p: string): string {
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= 2) return "/" + parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

/** Current agent mode chip — driven by ACP `current_mode_update`. Each
 *  agent owns its own mode catalog (codex: ask/auto/yolo; claude:
 *  bypass/default; gemini's thinking levels) so we just echo the id the
 *  agent declared. Hidden when the agent hasn't sent one. */
function ModeChip({ modeId }: { modeId?: string }) {
  if (!modeId) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        "bg-bg-surface text-fg-muted",
      )}
      title={`Agent mode · ${modeId}`}
    >
      {modeId}
    </span>
  );
}
