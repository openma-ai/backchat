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
import { cn } from "@/lib/utils";

interface Props {
  turnId: string;
  kind: "assistant" | "thought";
  className?: string;
}

export function StreamingMarkdown({ turnId, kind, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Reset host content on (re)mount so a route change between turns
    // doesn't leave stale DOM. The store's replay-on-subscribe will
    // re-render the current accumulator.
    host.replaceChildren();
    const parser = smd.parser(smd.default_renderer(host));
    const off = sessionStore.subscribeTurnStream(turnId, (d) => {
      if (d.kind !== kind) return;
      // Direct DOM mutation. No setState, no React render.
      smd.parser_write(parser, d.text);
    });
    return () => {
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
  }, [turnId, kind]);

  return (
    <div
      ref={hostRef}
      className={cn(
        // Match Streamdown's prose look so the streaming → final handoff
        // is visually seamless. Streamdown's CSS is the source of truth;
        // anything we do here is a near-twin until that final React
        // render takes over and applies the canonical classes.
        "streaming-md text-sm leading-relaxed text-fg",
        // Reuse the same prose-ish layout Streamdown uses internally.
        "[&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0",
        "[&>h1]:my-3 [&>h1]:text-base [&>h1]:font-semibold",
        "[&>h2]:my-3 [&>h2]:text-sm [&>h2]:font-semibold",
        "[&>h3]:my-3 [&>h3]:text-sm [&>h3]:font-semibold",
        "[&>ul]:my-2 [&>ul]:list-disc [&>ul]:pl-5",
        "[&>ol]:my-2 [&>ol]:list-decimal [&>ol]:pl-5",
        "[&_li]:my-0.5",
        "[&>pre]:my-2 [&>pre]:rounded-md [&>pre]:bg-bg-surface [&>pre]:p-2 [&>pre]:font-mono [&>pre]:text-[12px] [&>pre]:overflow-x-auto",
        "[&_code]:rounded [&_code]:bg-bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
        "[&>pre>code]:bg-transparent [&>pre>code]:p-0",
        "[&>blockquote]:my-2 [&>blockquote]:border-l-2 [&>blockquote]:border-border [&>blockquote]:pl-3 [&>blockquote]:text-fg-muted",
        "[&_a]:text-brand [&_a]:underline-offset-2 hover:[&_a]:underline",
        "[&>hr]:my-3 [&>hr]:border-border/60",
        "[&_strong]:font-semibold",
        "[&_em]:italic",
        className,
      )}
    />
  );
}
