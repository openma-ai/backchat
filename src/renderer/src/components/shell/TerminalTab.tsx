import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { cssFontFamily } from "@/lib/css-font";
import { terminalTextOptions } from "@/lib/terminal-text-options";
import { openExternalBrowserUrl, openInAppBrowserUrl } from "@/lib/browser-open";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  SearchIcon,
  XIcon,
} from "@/components/Icons";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * TerminalTab — one xterm.js instance bound to one pty in main.
 *
 * Lifecycle (this component is mount-once per terminalId; React StrictMode
 * mount/unmount/mount is handled by the cleanup running on the *second*
 * unmount — the terminal is keyed on terminalId so React reuses the same
 * element rather than spawning twice):
 *
 *   1. mount → create Terminal + addons + open into the host div
 *   2. subscribe to onUiTermData for this terminalId; pipe to term.write
 *   3. forward term.onData → uiTermInput (user keystrokes)
 *   4. ResizeObserver on the host → fit.proposeDimensions → uiTermResize
 *   5. unmount → dispose addons, dispose terminal, unsub listeners
 *
 * Performance notes:
 *   - WebGL addon promoted up-front. xterm.js sometimes silently falls
 *     back to canvas if the GL context can't be created (rare on macOS,
 *     possible on Linux with broken Mesa). We catch and ignore — canvas
 *     is the implicit default.
 *   - resize is fired through requestAnimationFrame to avoid bursting
 *     on flex layout transitions (the bottom panel slides open with a
 *     280 ms easing curve, every keyframe would otherwise emit a resize).
 */
export function TerminalTab({
  terminalId,
  initialCols = 80,
  initialRows = 24,
  cancellationRequested = false,
  surface = "panel",
}: {
  terminalId: string;
  /** Which material hosts the terminal: the bottom panel card ("panel") or
   *  the flat docked side rail ("canvas"). The terminal fills its host. */
  surface?: "panel" | "canvas";
  initialCols?: number;
  initialRows?: number;
  cancellationRequested?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [exit, setExit] = useState<TerminalExitState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ index: number; count: number } | null>(null);
  const presentation = terminalStatusPresentation(
    exit,
    cancellationRequested,
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cols: initialCols,
      rows: initialRows,
      ...terminalTextOptions(cssFontFamily("--font-mono")),
      cursorBlink: true,
      // Theme reads from CSS vars at construct time — xterm.js doesn't
      // pick up var() changes mid-session, so we resolve to concrete
      // hex via getComputedStyle once. dark-mode swap will re-fire
      // through the parent's `key` (BottomPanel keys the tab on theme
      // class) so a fresh terminal mounts.
      theme: resolveTheme(surface),
      allowProposedApi: true,
      scrollback: 10000,
      // Option-as-Meta so word jumps (⌥←/⌥→) and readline bindings work.
      macOptionIsMeta: true,
      smoothScrollDuration: 80,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    // Full-width CJK / emoji: without Unicode 11 widths, Chinese prompts and
    // emoji misalign the cursor.
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    // URLs become links: click opens the in-app browser, ⌘/Ctrl-click the
    // system browser.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.metaKey || event.ctrlKey) openExternalBrowserUrl(uri);
        else openInAppBrowserUrl(uri);
      }),
    );
    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;
    const searchResults = search.onDidChangeResults((r) =>
      setMatches(r ? { index: r.resultIndex, count: r.resultCount } : null),
    );
    term.open(host);

    // WebGL renderer — the perf headline. Falls back gracefully on
    // context-create failure (xterm.js logs to console).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // Canvas fallback is xterm.js's default; nothing to do here.
    }

    // First fit after the host has its real size. requestAnimationFrame
    // because the parent's flex/grid layout settles on the next frame.
    requestAnimationFrame(() => {
      try {
        fit.fit();
        void window.backchat.uiTermResize({
          terminalId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        /* host not yet measured — ResizeObserver will catch up */
      }
    });

    // Pipe pty data → terminal. The unsubscribe is what stops the
    // listener from leaking when the tab closes mid-stream.
    const offData = window.backchat.onUiTermData((f) => {
      if (f.terminalId !== terminalId) return;
      term.write(f.data);
    });
    const offExit = window.backchat.onUiTermExit((f) => {
      if (f.terminalId !== terminalId) return;
      setExit({ exitCode: f.exitCode, signal: f.signal });
      // Print a discreet footer so the user sees the shell ended. The
      // \r\n is needed because the cursor is wherever the last byte
      // left it; an unprefixed \n would push the message into the
      // last command's column.
      term.write(
        `\r\n\x1b[2m[Process exited${
          f.exitCode != null ? ` · code ${f.exitCode}` : ""
        }${f.signal ? ` · ${f.signal}` : ""}]\x1b[0m\r\n`,
      );
      term.options.disableStdin = true;
    });

    // Keystrokes → pty. xterm.js hands raw bytes already encoded
    // (e.g. Ctrl+C is "\x03"); pass through verbatim.
    const inputDisp = term.onData((data) => {
      void window.backchat.uiTermInput({ terminalId, data });
    });

    // ⌘C / Ctrl+C copy + ⌘V / Ctrl+V paste — xterm.js + WebGL renderer
    // doesn't hook the browser's native selection / clipboard, so we
    // intercept the keys before xterm.js converts them into terminal
    // byte sequences (Ctrl+C = "\x03" SIGINT).
    //
    // Copy: ONLY swallow ⌘C when there's an active selection. If the
    // terminal has nothing selected, ⌘C continues into pty as SIGINT,
    // matching macOS Terminal / iTerm2 behavior.
    // Paste: always go through clipboard.readText → pty.write so paste
    // is bracketed-paste-safe (xterm.js handles the wrapper if the
    // shell asked for it).
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      const mod = ev.metaKey || ev.ctrlKey;
      if (!mod) return true;
      // ⌘F opens find; ⌘K clears like macOS Terminal.
      if (ev.metaKey && (ev.key === "f" || ev.key === "F")) {
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.select());
        return false;
      }
      if (ev.metaKey && (ev.key === "k" || ev.key === "K")) {
        term.clear();
        return false;
      }
      if (ev.key === "c" || ev.key === "C") {
        if (term.hasSelection()) {
          const sel = term.getSelection();
          if (sel) {
            void navigator.clipboard.writeText(sel);
            // Clear selection so the next ⌘C doesn't re-copy stale
            // text; matches Codex / VSCode behavior.
            term.clearSelection();
          }
          return false;
        }
        // No selection → let xterm.js pass ⌘C through as SIGINT.
        return true;
      }
      if (ev.key === "v" || ev.key === "V") {
        void navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        });
        return false;
      }
      return true;
    });

    // Container resize → pty resize. Debounced via trailing setTimeout
    // so a multi-frame animation (sidebar collapse, bottom-panel
    // resize) coalesces into ONE fit at the end. Without the debounce,
    // every frame of the 280 ms sidebar collapse animation fires a
    // fresh fit + uiTermResize, and xterm.js's cursor briefly clears
    // each time — visible as a flicker. 60 ms is short enough that a
    // user's manual window-drag still feels responsive but long
    // enough to outlive any of our shell-level slide animations.
    let pendingFit: number | null = null;
    const FIT_DEBOUNCE_MS = 60;
    const runFit = () => {
      pendingFit = null;
      try {
        fit.fit();
        void window.backchat.uiTermResize({
          terminalId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        /* host removed mid-flight */
      }
    };
    const ro = new ResizeObserver(() => {
      if (pendingFit != null) clearTimeout(pendingFit);
      pendingFit = window.setTimeout(runFit, FIT_DEBOUNCE_MS);
    });
    ro.observe(host);

    // Focus on mount so typing starts immediately when a tab is
    // selected — matches every IDE terminal expectation.
    term.focus();

    // Click anywhere in the host → ensure the terminal's helper
    // textarea has keyboard focus. Without this, clicking outside
    // an already-selected range still leaves focus on whatever was
    // last focused (e.g. a settings toggle), and ⌘C / ⌘V never
    // reach our key handler because keydown is delivered to that
    // other element.
    //
    // Using pointerup (not pointerdown) so a click-drag selection
    // still completes — pointerdown would steal focus to textarea
    // before the user finishes the drag.
    const onHostClick = () => {
      if (document.activeElement !== term.textarea) term.focus();
    };
    host.addEventListener("pointerup", onHostClick);

    return () => {
      offData();
      offExit();
      searchResults.dispose();
      termRef.current = null;
      searchRef.current = null;
      inputDisp.dispose();
      ro.disconnect();
      host.removeEventListener("pointerup", onHostClick);
      if (pendingFit != null) clearTimeout(pendingFit);
      term.dispose();
    };
  }, [terminalId, initialCols, initialRows]);

  return (
    <div
      role="region"
      aria-label={`Terminal ${terminalId}`}
      data-testid="foreground-terminal"
      data-terminal-id={terminalId}
      data-terminal-status={presentation.status}
      className="group/terminal relative h-full w-full overflow-hidden"
      // Background matches the bottom panel's --bg card surface.
      // xterm-addon-webgl draws on an OPAQUE framebuffer — transparent
      // themes don't work on the WebGL renderer (it ignores
      // theme.background alpha). Matching the host bg is the only way
      // to make the terminal blend with the panel.
      //
      // `transform: translateZ(0)` promotes the host to its own
      // compositor layer. Without this, when the bottom panel's `left`
      // CSS transitions during a sidebar collapse (280ms), the WebGL
      // canvas inside gets repainted-from-scratch on every compositor
      // frame instead of being moved as a pre-rendered layer — that's
      // the "all text flashes" the user sees. Layer promotion costs ~
      // one VRAM allocation but eliminates the repaint cost entirely.
      style={{
        background: surface === "canvas" ? "var(--surface-canvas)" : "var(--bg-surface)",
        transform: "translateZ(0)",
        willChange: "transform",
      }}
    >
      <div ref={hostRef} className="h-full w-full" />
      {searchOpen ? (
        <TerminalFindBar
          inputRef={searchInputRef}
          query={query}
          matches={matches}
          onQuery={(next) => {
            setQuery(next);
            if (next) searchRef.current?.findNext(next, findOptions(surface, true));
            else searchRef.current?.clearDecorations();
          }}
          onNext={() => query && searchRef.current?.findNext(query, findOptions(surface))}
          onPrevious={() => query && searchRef.current?.findPrevious(query, findOptions(surface))}
          onClose={() => {
            setSearchOpen(false);
            searchRef.current?.clearDecorations();
            setMatches(null);
            termRef.current?.focus();
          }}
        />
      ) : (
        // Hover tools: quiet until the pointer is over the terminal.
        <div
          data-terminal-tools="true"
          className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md bg-bg/80 p-0.5 opacity-0 ring-1 ring-border/60 backdrop-blur-sm transition-opacity group-hover/terminal:pointer-events-auto group-hover/terminal:opacity-100"
        >
          <TerminalToolButton
            label="Find (⌘F)"
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.select());
            }}
          >
            <SearchIcon className="size-3.5" />
          </TerminalToolButton>
          <TerminalToolButton
            label="Copy all output"
            onClick={() => {
              const term = termRef.current;
              if (!term) return;
              term.selectAll();
              const text = term.getSelection();
              term.clearSelection();
              if (text) void navigator.clipboard.writeText(text.trimEnd());
            }}
          >
            <CopyIcon className="size-3.5" />
          </TerminalToolButton>
          <TerminalToolButton label="Clear (⌘K)" onClick={() => termRef.current?.clear()}>
            <XIcon className="size-3.5" />
          </TerminalToolButton>
        </div>
      )}
      <span
        data-testid="foreground-terminal-status"
        data-terminal-status-visible={presentation.status === "running" ? undefined : "true"}
        className={cn(
          "app-raised-surface pointer-events-none absolute bottom-2 right-2 z-10 rounded-md px-2 py-1 text-[10px] font-medium ring-1 ring-border/60",
          // A running shell needs no badge; only an ended one says how it ended.
          presentation.status === "running" ? "sr-only" : "",
          presentation.status === "failed" ? "text-danger" : "text-fg-muted",
        )}
        aria-live="polite"
      >
        {presentation.label}
      </span>
    </div>
  );
}

interface TerminalExitState {
  exitCode: number | null;
  signal: string | null;
}

export function terminalStatusPresentation(
  exit: TerminalExitState | null,
  cancellationRequested = false,
): { status: "running" | "cancelling" | "exited" | "failed" | "cancelled"; label: string } {
  if (!exit) {
    return cancellationRequested
      ? { status: "cancelling", label: "Cancelling" }
      : { status: "running", label: "Running" };
  }
  const suffix = exit.signal
    ? ` · ${exit.signal}`
    : exit.exitCode != null
      ? ` · code ${exit.exitCode}`
      : "";
  if (cancellationRequested) {
    return { status: "cancelled", label: `Cancelled${suffix}` };
  }
  if (exit.exitCode === 0 && !exit.signal) {
    return { status: "exited", label: `Exited${suffix}` };
  }
  return { status: "failed", label: `Failed${suffix}` };
}

/** Resolve CSS vars to literal hex once at construct time. xterm.js's
 *  theme object only reads on construction — dark-mode swap requires a
 *  fresh terminal (handled at the parent via `key`). */
function resolveTheme(surface: "panel" | "canvas") {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || undefined;
  return {
    // Matches the host material so the terminal has no visible box.
    background: v(surface === "canvas" ? "--surface-canvas" : "--bg-surface"),
    foreground: v("--fg"),
    // A neutral ink cursor: color earns its place, and a blinking brand
    // block read as an error mark.
    cursor: v("--fg-muted"),
    cursorAccent: v(surface === "canvas" ? "--surface-canvas" : "--bg-surface"),
    // ANSI palette — pull from the existing semantic tokens so the
    // terminal's red/green/yellow match the rest of the app's danger /
    // success / warning hues. Falls back to xterm.js defaults when
    // unset.
    red: v("--danger"),
    green: v("--success"),
    yellow: v("--warning"),
    blue: v("--info"),
    magenta: v("--accent-violet"),
  };
}

/** Match highlights in the terminal's own palette: a quiet wash for every
 *  hit, ink outline for the active one. */
function findOptions(surface: "panel" | "canvas", incremental = false) {
  const cs = getComputedStyle(document.documentElement);
  // The search addon only accepts #RRGGBB; theme tokens may carry alpha
  // (#RRGGBBAA) or be another color space, so normalize or fall back.
  const v = (name: string) => {
    const raw = cs.getPropertyValue(name).trim();
    const hex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(raw);
    return hex ? `#${hex[1]}` : "";
  };
  return {
    incremental,
    decorations: {
      matchBackground: v("--bg-bubble") || "#e8e8e8",
      matchOverviewRuler: v("--fg-subtle") || "#999999",
      activeMatchBackground: v(surface === "canvas" ? "--bg-surface" : "--bg") || "#ffffff",
      activeMatchBorder: v("--fg") || "#141414",
      activeMatchColorOverviewRuler: v("--fg") || "#141414",
    },
  };
}

function TerminalToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-[var(--control-bg-hover)] hover:text-fg"
    >
      {children}
    </button>
  );
}

function TerminalFindBar({
  inputRef,
  query,
  matches,
  onQuery,
  onNext,
  onPrevious,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  matches: { index: number; count: number } | null;
  onQuery: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const counter = !query
    ? ""
    : matches && matches.count > 0
      ? `${matches.index + 1}/${matches.count}`
      : "0/0";
  return (
    <div
      data-terminal-find="true"
      className="absolute right-2 top-2 z-20 flex h-8 items-center gap-1 rounded-lg bg-bg py-1 pl-2 pr-1 shadow-sm ring-1 ring-border"
    >
      <SearchIcon className="size-3.5 shrink-0 text-fg-subtle" />
      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={t("terminal.find")}
        aria-label={t("terminal.findInTerminal")}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          }
        }}
        className="w-40 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint"
      />
      <span className="min-w-8 text-right text-[11px] tabular-nums text-fg-subtle">{counter}</span>
      <TerminalToolButton label="Previous match (⇧Enter)" onClick={onPrevious}>
        <ChevronUpIcon className="size-3.5" />
      </TerminalToolButton>
      <TerminalToolButton label="Next match (Enter)" onClick={onNext}>
        <ChevronDownIcon className="size-3.5" />
      </TerminalToolButton>
      <TerminalToolButton label="Close (Esc)" onClick={onClose}>
        <XIcon className="size-3.5" />
      </TerminalToolButton>
    </div>
  );
}
