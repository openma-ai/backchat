import { CommandIcon, MoonStarIcon, PlusIcon, SunIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  sessionStore,
  selectActiveId,
  selectSessions,
  useSessionStore,
  type SessionRow,
} from "@/lib/session-store";

interface SidebarProps {
  agents: Array<{ id: string; label: string; detected: boolean; installHint?: string }>;
  onNewSession: (agentId: string) => void;
}

export function Sidebar({ agents, onNewSession }: SidebarProps) {
  const sessions = useSessionStore(selectSessions);
  const activeId = useSessionStore(selectActiveId);
  const { theme, setTheme, effective } = useTheme();
  const [picker, setPicker] = useState(false);
  const detected = agents.filter((a) => a.detected);
  const undetected = agents.filter((a) => !a.detected);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand row — h-11 to match the topbar's breadcrumb baseline. The
          app-drag-region class lets the user drag the window from the empty
          space; concrete affordances opt out via app-no-drag. */}
      <div className="app-drag-region flex h-11 shrink-0 items-center justify-between pl-3 pr-1">
        <span className="font-mono text-[13px] tracking-tight">
          <span className="text-fg-muted">[</span>
          <span className="font-medium">openma</span>
          <span className="text-fg-muted">]</span>
        </span>

        <DropdownMenu open={picker} onOpenChange={setPicker}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="app-no-drag size-7"
              aria-label="New session"
            >
              <PlusIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs text-fg-muted">
              Start a session
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {detected.length === 0 && (
              <div className="px-2 py-3 text-xs text-fg-muted">
                No ACP agents detected on PATH. Install one and restart.
              </div>
            )}
            {detected.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onSelect={() => {
                  setPicker(false);
                  onNewSession(a.id);
                }}
                className="gap-2"
              >
                <TerminalIcon className="size-3.5 text-fg-muted" />
                <span className="flex-1">{a.label}</span>
                <span className="font-mono text-[10px] text-fg-subtle">{a.id}</span>
              </DropdownMenuItem>
            ))}
            {undetected.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-fg-subtle">
                  Not installed
                </DropdownMenuLabel>
                {undetected.slice(0, 6).map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    disabled
                    className="gap-2 text-fg-subtle"
                  >
                    <span className="flex-1">{a.label}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Cmd+K placeholder — wired in Phase 7. */}
      <div className="px-2 pb-2">
        <button
          className={cn(
            "app-no-drag flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-fg-muted",
            "bg-bg-surface/50 hover:bg-bg-surface",
            "transition-colors",
          )}
          disabled
        >
          <CommandIcon className="size-3.5" />
          <span>Search</span>
          <span className="ml-auto font-mono text-[10px] text-fg-subtle">⌘K</span>
        </button>
      </div>

      {/* Sections — nav groups. Single "Sessions" group for Phase 3. */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          Sessions
        </div>
        {sessions.length === 0 ? (
          <div className="px-2 py-3 text-xs text-fg-muted">
            No sessions yet. Click <span className="font-mono">+</span> above.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <SessionRowButton row={s} active={s.id === activeId} />
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* Theme toggle — bottom strip. No top border; the sidebar's
          transparent bg + the stage band already separate it from the nav. */}
      <div className="px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="app-no-drag w-full justify-start gap-2 text-fg-muted hover:bg-bg-surface/50"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {effective === "dark" ? (
            <SunIcon className="size-3.5" />
          ) : (
            <MoonStarIcon className="size-3.5" />
          )}
          <span className="text-xs">
            {effective === "dark" ? "Light mode" : "Dark mode"}
          </span>
        </Button>
      </div>
    </div>
  );
}

function SessionRowButton({ row, active }: { row: SessionRow; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => sessionStore.setActive(row.id)}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        active
          ? "bg-bg-surface text-fg"
          : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
      )}
      title={row.lastError}
    >
      <StatusDot status={row.status} />
      <span className="flex-1 truncate">{row.label}</span>
      <span className="font-mono text-[10px] text-fg-subtle group-hover:text-fg-muted">
        {row.agent_id.replace(/-acp$/, "")}
      </span>
    </button>
  );
}

function StatusDot({ status }: { status: SessionRow["status"] }) {
  const color =
    status === "running"
      ? "bg-brand"
      : status === "ready"
        ? "bg-success"
        : status === "errored"
          ? "bg-danger"
          : status === "starting"
            ? "bg-warning"
            : "bg-fg-subtle";
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", color)}
      aria-hidden="true"
    />
  );
}
