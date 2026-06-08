import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

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
}: {
  terminalId: string;
  initialCols?: number;
  initialRows?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cols: initialCols,
      rows: initialRows,
      // Geist Mono → JetBrains Mono → SF Mono. The bracket characters
      // and box-drawing chars are the discriminator between "nice" and
      // "tofu" — JetBrains Mono Variable ships them, .impeccable.md
      // already loads it.
      fontFamily:
        '"JetBrains Mono Variable", "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      // Theme reads from CSS vars at construct time — xterm.js doesn't
      // pick up var() changes mid-session, so we resolve to concrete
      // hex via getComputedStyle once. dark-mode swap will re-fire
      // through the parent's `key` (BottomPanel keys the tab on theme
      // class) so a fresh terminal mounts.
      theme: resolveTheme(),
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
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
      inputDisp.dispose();
      ro.disconnect();
      host.removeEventListener("pointerup", onHostClick);
      if (pendingFit != null) clearTimeout(pendingFit);
      term.dispose();
    };
  }, [terminalId, initialCols, initialRows]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden"
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
        background: "var(--bg)",
        transform: "translateZ(0)",
        willChange: "transform",
      }}
    />
  );
}

/** Resolve CSS vars to literal hex once at construct time. xterm.js's
 *  theme object only reads on construction — dark-mode swap requires a
 *  fresh terminal (handled at the parent via `key`). */
function resolveTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim() || undefined;
  return {
    // Matches the bottom panel's --bg card surface.
    background: v("--bg"),
    foreground: v("--fg"),
    cursor: v("--brand"),
    cursorAccent: v("--bg"),
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
