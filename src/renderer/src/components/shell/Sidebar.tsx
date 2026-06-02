import {
  CommandIcon,
  MessageSquarePlusIcon,
  MoonStarIcon,
  Settings2Icon,
  SunIcon,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  newDraftSession,
  selectActiveId,
  selectSessions,
  sessionStore,
  useSessionStore,
  type SessionRow,
} from "@/lib/session-store";

/**
 * Sidebar — sessions list + "+ New chat" + Settings link + theme toggle.
 *
 * Dropped from Phase 3.0:
 *   - the agent-picker dropdown that used to live behind "+". Agent now
 *     comes from settings.default.agent_id (the "default browser" model);
 *     the picker for switching default lives in /settings/agents.
 */
export function Sidebar() {
  const sessions = useSessionStore(selectSessions);
  const activeId = useSessionStore(selectActiveId);
  const { theme, setTheme, effective } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const onNewChat = () => {
    const sid = newDraftSession();
    void navigate({ to: "/chat/$sessionId", params: { sessionId: sid } });
  };

  const onSelectSession = (id: string) => {
    sessionStore.setActive(id);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  };

  const settingsActive = location.pathname.startsWith("/settings");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand row — h-11. The "+ New chat" button lives here so a click is
          always one move away regardless of which sidebar section is open. */}
      <div className="app-drag-region flex h-11 shrink-0 items-center justify-between pl-3 pr-1">
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="app-no-drag font-mono text-[13px] tracking-tight"
          aria-label="openma home"
        >
          <span className="text-fg-muted">[</span>
          <span className="font-medium">openma</span>
          <span className="text-fg-muted">]</span>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="app-no-drag size-7"
          onClick={onNewChat}
          aria-label="New chat"
          title="New chat"
        >
          <MessageSquarePlusIcon className="size-4" />
        </Button>
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

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          Chats
        </div>
        {sessions.length === 0 ? (
          <button
            type="button"
            onClick={onNewChat}
            className="block w-full px-2 py-2 text-left text-xs text-fg-muted hover:text-fg"
          >
            Start a new chat
          </button>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <SessionRowButton
                  row={s}
                  active={s.id === activeId && location.pathname.startsWith("/chat/")}
                  onClick={() => onSelectSession(s.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* Footer — Settings link + theme toggle. Both sit on the same level
          because they're "app-wide preferences", separate from the
          conversation context above. */}
      <div className="px-2 py-2 space-y-0.5">
        <Link
          to="/settings"
          className={cn(
            "app-no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs",
            settingsActive
              ? "bg-bg-surface text-fg"
              : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
          )}
        >
          <Settings2Icon className="size-3.5" />
          <span>Settings</span>
        </Link>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
          className={cn(
            "app-no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs",
            "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
          )}
        >
          {effective === "dark" ? (
            <SunIcon className="size-3.5" />
          ) : (
            <MoonStarIcon className="size-3.5" />
          )}
          <span>{effective === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </div>
  );
}

function SessionRowButton({
  row,
  active,
  onClick,
}: {
  row: SessionRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        {row.agent_id ? row.agent_id.replace(/-acp$/, "") : "—"}
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
            : status === "draft"
              ? "bg-fg-subtle"
              : "bg-fg-subtle";
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", color)}
      aria-hidden="true"
    />
  );
}