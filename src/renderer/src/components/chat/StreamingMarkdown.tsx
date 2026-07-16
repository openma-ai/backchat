/**
 * StreamingMarkdown — DOM-mutating renderer for the streaming half of the
 * dual-track chat surface. Subscribes to the session store's per-turn
 * stream channel and pushes deltas straight into thetarnav/streaming-
 * markdown's parser, which appends DOM nodes to a ref'd <div> WITHOUT
 * any React reconciliation.
 *
 * Why bypass React: streaming a multi-KB markdown response into React
 * state forces a tree diff on every chunk (60+ chunks/sec, 10–30ms each).
 * The visible "stall" Claude Desktop / Alma avoid is exactly this. Here
 * React only sees a single inert <div ref> — no children prop, no state
 * — for the entire stream. When the turn completes, the parent unmounts
 * this component and replaces it with a Streamdown-rendered final view
 * (memoized + plugin-rich). The handoff is one render, not 1000.
 *
 * The same shape applies to thought streams; pass kind="thought" to
 * subscribe to that subchannel.
 */

import { useEffect, useRef } from "react";
import * as smd from "streaming-markdown";
import { sessionStore } from "@/lib/session-store";
import { openBrowserAwareUrl } from "@/lib/browser-open";
import { cn } from "@/lib/utils";

interface Props {
  turnId: string;
  kind: "assistant" | "thought";
  className?: string;
  /** Base dir used to resolve bare-relative href links into absolute
   *  file paths before handing them to uiFsOpenPath. Typically the
   *  active session's cwd. When omitted, relative links are no-op'd
   *  on click instead of being navigated. */
  cwd?: string | null;
  /** Number of characters to skip from the START of the replayed
   *  accumulator on mount. Used by segment-aware interleaving — when
   *  a tool breaks the assistant flow, earlier text segments are
   *  rendered statically by the parent above the tool; this component
   *  mounts AFTER the tool and should only render the TAIL of the
   *  accumulator (everything since the last flush). Live deltas that
   *  arrive after mount are always appended in full — only the initial
   *  replay is sliced. */
  prefixSkip?: number;
}

export function StreamingMarkdown({ turnId, kind, className, cwd, prefixSkip = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Stash cwd in a ref so the click handler always sees the latest
  // value without forcing the parser to remount when cwd changes mid-
  // stream (which would lose all the DOM mutations and reset the chat
  // visual).
  const cwdRef = useRef<string | null>(cwd ?? null);
  cwdRef.current = cwd ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Reset host content on (re)mount so a route change between turns
    // doesn't leave stale DOM. The store's replay-on-subscribe will
    // re-render the current accumulator.
    host.replaceChildren();
    const parser = smd.parser(smd.default_renderer(host));
    // First handler invocation is the synchronous replay of the current
    // accumulator (see sessionStore.subscribeTurnStream). For
    // segment-aware interleaving the parent renders earlier assistant
    // segments statically above this component, so we slice the first
    // `prefixSkip` chars off the replay payload — the rendered tail
    // covers only "everything after the last tool break". Live deltas
    // arriving after that first call are always appended in full.
    let replayConsumed = false;
    const off = sessionStore.subscribeTurnStream(turnId, (d) => {
      if (d.kind !== kind) return;
      let text = d.text;
      if (!replayConsumed) {
        replayConsumed = true;
        if (prefixSkip > 0 && text.length > prefixSkip) {
          text = text.slice(prefixSkip);
        } else if (prefixSkip >= text.length) {
          // Replay already fully covered by static segments above —
          // nothing to render until the next live delta.
          return;
        }
      }
      // Direct DOM mutation. No setState, no React render.
      smd.parser_write(parser, text);
    });
    // Event delegation for <a> clicks. streaming-markdown emits raw
    // <a href=...> nodes that, when clicked, would let Chromium
    // navigate the whole renderer to the link's URL — fine for
    // http(s) which we'd want in the system browser, fatal for bare
    // relative paths which would resolve against the dev-server
    // origin (image #93). Intercept here and route the same way the
    // post-stream Streamdown <a> override does.
    const onClickAnchor = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const a = target?.closest("a") as HTMLAnchorElement | null;
      if (!a || !host.contains(a)) return;
      e.preventDefault();
      e.stopPropagation();
      const url = (a.getAttribute("href") ?? "").trim();
      if (!url) return;
      if (/^https?:\/\//i.test(url)) {
        openBrowserAwareUrl(url);
        return;
      }
      // Compute the absolute path early so html/non-html routing can
      // share the same resolved value. file:// strips its scheme, /abs
      // passes through, bare relative joins with cwdRef.
      let path: string | null = null;
      if (/^file:\/\//i.test(url)) path = url.slice(7);
      else if (url.startsWith("/")) path = url;
      else if (url.startsWith("#") || url.startsWith("?") || url.startsWith("mailto:")) return;
      else {
        const base = cwdRef.current;
        if (!base) return;
        path = base.replace(/\/$/, "") + "/" + url.replace(/^\.\//, "");
      }
      if (!path) return;
      // HTML → sidebar BrowserTab (in-app preview, matches the
      // auto-open-on-tool-completion behavior). Anything else → OS
      // default app.
      if (/\.html?$/i.test(path)) {
        openBrowserAwareUrl(
          "file://" + path,
          path.split("/").pop() || path,
        );
        return;
      }
      void window.backchat.uiFsOpenPath({ path });
    };
    host.addEventListener("click", onClickAnchor);
    return () => {
      host.removeEventListener("click", onClickAnchor);
      off();
      // Tell the parser we're done so any half-open inline element
      // (e.g. an unfinished `**` emphasis) flushes as plain text instead
      // of staying open in the DOM. The host node itself is removed by
      // React on unmount, so we don't need to clear it manually.
      try {
        smd.parser_end(parser);
      } catch {
        /* parser_end can throw on certain partial states; not fatal. */
      }
    };
  }, [turnId, kind, prefixSkip]);

  return (
    <div
      ref={hostRef}
      className={cn(
        // Match Streamdown's prose look so the streaming → final handoff
        // is visually seamless. Streamdown's CSS is the source of truth;
        // anything we do here is a near-twin until that final React
        // render takes over and applies the canonical classes.
        // Density matches the post-stream <StreamdownText> in ChatView —
        // 13px + leading-6, paragraph my-1.5. codex-comparable.
        "streaming-md text-[13px] leading-6 text-fg",
        "[&>p]:my-1.5 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0",
        "[&>h1]:my-2 [&>h1]:text-base [&>h1]:font-semibold",
        "[&>h2]:my-2 [&>h2]:text-sm [&>h2]:font-semibold",
        "[&>h3]:my-2 [&>h3]:text-sm [&>h3]:font-semibold",
        "[&>ul]:my-1.5 [&>ul]:list-disc [&>ul]:pl-5",
        "[&>ol]:my-1.5 [&>ol]:list-decimal [&>ol]:pl-5",
        "[&_li]:my-0.5",
        "[&>pre]:my-2 [&>pre]:rounded-lg [&>pre]:border [&>pre]:border-border/60 [&>pre]:bg-bg-surface/60 [&>pre]:px-3 [&>pre]:py-2 [&>pre]:font-mono [&>pre]:text-[12px] [&>pre]:leading-5 [&>pre]:overflow-x-auto",
        "[&_code]:rounded [&_code]:bg-bg-surface/70 [&_code]:px-[0.35em] [&_code]:py-[0.1em] [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&>pre>code]:bg-transparent [&>pre>code]:px-0 [&>pre>code]:py-0 [&>pre>code]:text-[12px]",
        "[&>blockquote]:my-2 [&>blockquote]:border-l-2 [&>blockquote]:border-border [&>blockquote]:pl-3 [&>blockquote]:text-fg-muted",
        "[&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-fg-muted",
        "[&>hr]:my-3 [&>hr]:border-border/60",
        "[&_strong]:font-semibold",
        "[&_em]:italic",
        className,
      )}
    />
  );
}
