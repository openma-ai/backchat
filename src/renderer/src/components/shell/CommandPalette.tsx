/**
 * Global Cmd+K palette — Recent / Actions / Navigate / Search (taste-saas
 * four-section recipe). Mounted once in ShellLayout. Dual key binding:
 * ⌘K on macOS, Ctrl+K elsewhere (we bind both unconditionally — Electron's
 * input target is always the same, no platform-specific gymnastics).
 *
 * Search is server-side via the FTS5 virtual table backing the events log
 * (see src/main/sql-store.ts). Debounced 120ms, only fires when the query
 * is at least 2 chars (single char would dump the entire index).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
  ClockIcon,
  MessageSquarePlusIcon,
  MoonStarIcon,
  Settings2Icon,
  SunIcon,
  SearchIcon,
  CornerDownLeftIcon,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import {
  newDraftSession,
  selectSessions,
  sessionStore,
  useSessionStore,
} from "@/lib/session-store";
import { AgentIcon } from "@/components/AgentIcon";
import type { SearchHitInfo } from "@shared/api.js";

/** Lives in localStorage; ring of last opened session ids, MRU. */
const RECENT_KEY = "openma:recent-sessions";
const RECENT_CAP = 10;

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecent(sessionId: string): void {
  const cur = loadRecent().filter((x) => x !== sessionId);
  cur.unshift(sessionId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_CAP)));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHitInfo[]>([]);
  const sessions = useSessionStore(selectSessions);
  const sessionMap = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions],
  );
  const navigate = useNavigate();
  const { theme, setTheme, effective } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  // Dual-key bind. We catch the key on the document so it works regardless
  // of whether focus is in a text input — Cmd+K is global, the only way
  // the user should NOT be able to fire it is reduced-motion settings or
  // platform default (e.g. it's also Chrome's address-bar shortcut, but
  // we're in Electron not Chrome).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Debounced server-side search. Only fires for ≥2 chars to keep the
  // FTS lookups cheap and the results meaningful.
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      void window.openma
        .sessionsSearch(query, 12)
        .then((r) => setHits(r))
        .catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(handle);
  }, [query]);

  // Reset query on close. Reopens always start blank — there's no
  // "last query" use case worth preserving and a stale one would be
  // confusing.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    } else {
      // Focus the input on the next frame (Dialog mount races with
      // autoFocus otherwise on some Radix versions).
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const recentIds = loadRecent();
  const recentRows = recentIds
    .map((id) => sessionMap.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .slice(0, 5);

  const goSession = (id: string) => {
    sessionStore.setActive(id);
    pushRecent(id);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
    setOpen(false);
  };

  const actionNewChat = () => {
    const sid = newDraftSession();
    pushRecent(sid);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: sid } });
    setOpen(false);
  };
  const actionToggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="!max-w-xl gap-0 overflow-hidden p-0">
        <Command
          shouldFilter={query.length < 2}
          className="flex max-h-[460px] flex-col"
          label="Command palette"
        >
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
            <SearchIcon className="size-3.5 shrink-0 text-fg-subtle" />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search chats…"
              className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
            />
            <kbd className="rounded bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
              esc
            </kbd>
          </div>

          <Command.List className="flex-1 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-xs text-fg-muted">
              No results.
            </Command.Empty>

            {/* SEARCH (only when query ≥ 2). Server-side via FTS5. */}
            {query.trim().length >= 2 && hits.length > 0 && (
              <CmdGroup heading="Matches">
                {hits.map((h) => (
                  <Command.Item
                    key={`${h.session_id}-${h.seq}`}
                    value={`search-${h.session_id}-${h.seq}`}
                    onSelect={() => goSession(h.session_id)}
                    className={itemClass}
                  >
                    <AgentIcon
                      agentId={h.agent_id}
                      className="size-3.5 shrink-0 text-fg-subtle"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-fg">
                        {h.session_title || h.session_id.slice(0, 12)}
                      </div>
                      <div className="truncate text-[11px] text-fg-muted">
                        <Snippet text={h.snippet} />
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] uppercase text-fg-subtle">
                      {h.type === "user_prompt" ? "you" : "agent"}
                    </span>
                  </Command.Item>
                ))}
              </CmdGroup>
            )}

            {/* RECENT (always-on when query empty). */}
            {query.length === 0 && recentRows.length > 0 && (
              <CmdGroup heading="Recent">
                {recentRows.map((s) => (
                  <Command.Item
                    key={s.id}
                    value={`recent-${s.id} ${s.label}`}
                    onSelect={() => goSession(s.id)}
                    className={itemClass}
                  >
                    <ClockIcon className="size-3.5 shrink-0 text-fg-subtle" />
                    <span className="flex-1 truncate text-fg">{s.label}</span>
                    {s.agent_id && (
                      <AgentIcon
                        agentId={s.agent_id}
                        className="size-3.5 shrink-0 text-fg-subtle"
                      />
                    )}
                  </Command.Item>
                ))}
              </CmdGroup>
            )}

            {/* ACTIONS — always present, but appear before navigate. */}
            <CmdGroup heading="Actions">
              <Command.Item
                value="action-new-chat"
                onSelect={actionNewChat}
                className={itemClass}
              >
                <MessageSquarePlusIcon className="size-3.5 shrink-0 text-fg-subtle" />
                <span className="flex-1 text-fg">New chat</span>
                <KbdHint>n</KbdHint>
              </Command.Item>
              <Command.Item
                value="action-toggle-theme"
                onSelect={actionToggleTheme}
                className={itemClass}
              >
                {effective === "dark" ? (
                  <SunIcon className="size-3.5 shrink-0 text-fg-subtle" />
                ) : (
                  <MoonStarIcon className="size-3.5 shrink-0 text-fg-subtle" />
                )}
                <span className="flex-1 text-fg">
                  {effective === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                </span>
              </Command.Item>
            </CmdGroup>

            {/* NAVIGATE — sidebar routes. */}
            <CmdGroup heading="Navigate">
              <Command.Item
                value="nav-home"
                onSelect={() => {
                  void navigate({ to: "/" });
                  setOpen(false);
                }}
                className={itemClass}
              >
                <SearchIcon className="size-3.5 shrink-0 text-fg-subtle opacity-0" />
                <span className="flex-1 text-fg">Home</span>
                <KbdHint>g h</KbdHint>
              </Command.Item>
              <Command.Item
                value="nav-settings"
                onSelect={() => {
                  void navigate({ to: "/settings" });
                  setOpen(false);
                }}
                className={itemClass}
              >
                <Settings2Icon className="size-3.5 shrink-0 text-fg-subtle" />
                <span className="flex-1 text-fg">Settings</span>
                <KbdHint>g ,</KbdHint>
              </Command.Item>
            </CmdGroup>

            {/* All chats — last (so Recent + Actions land above the fold). */}
            {query.length === 0 && sessions.length > 0 && (
              <CmdGroup heading="All chats">
                {sessions.slice(0, 30).map((s) => (
                  <Command.Item
                    key={`all-${s.id}`}
                    value={`all-${s.id} ${s.label}`}
                    onSelect={() => goSession(s.id)}
                    className={itemClass}
                  >
                    {s.agent_id ? (
                      <AgentIcon
                        agentId={s.agent_id}
                        className="size-3.5 shrink-0 text-fg-subtle"
                      />
                    ) : (
                      <span className="size-3.5 shrink-0" />
                    )}
                    <span className="flex-1 truncate text-fg">{s.label}</span>
                  </Command.Item>
                ))}
              </CmdGroup>
            )}
          </Command.List>

          <div className="flex items-center justify-end gap-2 border-t border-border/40 px-3 py-1.5 text-[10px] text-fg-subtle">
            <span className="inline-flex items-center gap-1">
              <CornerDownLeftIcon className="size-3" />
              to open
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded bg-bg-surface px-1 py-0.5 font-mono text-[9px]">
                ↑↓
              </kbd>
              to navigate
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CmdGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={
        <span className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          {heading}
        </span>
      }
    >
      {children}
    </Command.Group>
  );
}

function KbdHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
      {children}
    </kbd>
  );
}

/** Render FTS5 snippet — unwrap ⁨…⁩ tags into <mark>. */
function Snippet({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /⁨([^⁩]+)⁩/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={i++} className="rounded bg-brand-subtle px-0.5 text-brand-fg">
        {m[1]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const itemClass = cn(
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
  "data-[selected=true]:bg-bg-surface text-fg-muted data-[selected=true]:text-fg",
  "cursor-pointer outline-none",
);
