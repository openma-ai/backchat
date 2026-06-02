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
import { AgentIcon } from "@/components/AgentIcon";

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
      {/* Top row — h-11. Just the "+ New chat" affordance pinned right.
          No brand mark: the window title bar already identifies the app
          (macOS hidden-titlebar still shows the app name on app-switch);
          spending a full row on `[openma]` was real estate competing with
          the chat list, and the audit pass flagged it as redundant. */}
      <div className="app-drag-region flex h-11 shrink-0 items-center justify-end pr-1">
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

      {/* Cmd+K placeholder — wired in Phase 7. Hidden in narrow mode. */}
      <div className="px-2 pb-2 max-md:hidden">
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
        <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle max-md:hidden">
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
          <span className="max-md:hidden">Settings</span>
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
          <span className="max-md:hidden">{effective === "dark" ? "Light mode" : "Dark mode"}</span>
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
  const running = row.status === "running" || row.status === "starting";
  const errored = row.status === "errored";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
        // Single tiny color affordance for errors — everything else stays
        // monochrome. Colored dots were too dashboard-y. The icon glow
        // (below) carries running state without a circus.
        errored && "text-danger",
        active
          ? "bg-bg-surface text-fg"
          : !errored && "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
        // Focus-visible: subtle inset ring instead of the global 2px
        // outline so keyboard-tab through the sidebar reads as
        // "selected" rather than "outlined".
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/50 focus-visible:ring-inset",
        // Animate bg+color via Tailwind's blanket transition-colors —
        // simpler than spelling out the property list.
        "transition-colors duration-[var(--dur-base)] ease-[var(--ease-soft)]",
      )}
      title={row.lastError ?? row.agent_id}
    >
      <span className="flex-1 truncate max-md:hidden">{row.label}</span>
      {row.agent_id && (
        <span
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center",
            "max-md:mx-auto",
            // Running: brand-tinted icon with a slow breathing halo. No
            // colored dot, no badge, no ring — just the icon itself
            // feeling alive. taste-saas calls this "the only thing that
            // moves earns the attention".
            running ? "text-brand" : "text-fg-subtle group-hover:text-fg-muted",
            "transition-colors duration-[var(--dur-base)] ease-[var(--ease-soft)]",
          )}
        >
          {running && (
            <span
              aria-hidden="true"
              className="agent-breath pointer-events-none absolute inset-[-4px] rounded-full"
            />
          )}
          <AgentIcon
            agentId={row.agent_id}
            className="relative size-3.5"
            title={row.agent_id}
          />
        </span>
      )}
    </button>
  );
}