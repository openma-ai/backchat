import { useEffect, useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/session-store";

// Below this many user messages the scrubber is noise — short chats
// don't need jump-navigation and the strip just crowds the right edge.
const MIN_PROMPTS = 5;

/**
 * ConversationTimeline — ChatGPT-style scrubber hugging the right edge
 * of the conversation scroll area. One tick per user message (turn);
 * the tick for the turn currently in view is emphasized. Hovering the
 * strip opens a panel listing one-line previews of every user message;
 * clicking a row (or a tick) smooth-scrolls the conversation there.
 *
 * Must render INSIDE <Conversation> — it reads the scroll element via
 * useStickToBottomContext() (same precedent as ConversationScrollButton).
 *
 * Active-turn tracking is a passive scroll listener + rAF throttle,
 * deliberately NOT an IntersectionObserver/ResizeObserver — observers
 * competing with use-stick-to-bottom's own ResizeObserver froze the
 * chat mid-stream before (see ToolRow's bodyMaxH comment in ChatView).
 */
export function ConversationTimeline({ turns }: { turns: Turn[] }) {
  const stick = useStickToBottomContext();
  const prompts = turns.filter((t) => t.promptText);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // --- active-turn tracking -------------------------------------------
  // Pick the last turn whose top edge has crossed a line 40% down the
  // scroll viewport. Read-only work, throttled to one measurement per
  // frame; setActiveId bails when unchanged so scrolls don't re-render.
  const promptCount = prompts.length;
  useEffect(() => {
    const scrollEl = stick.scrollRef.current;
    if (!scrollEl || promptCount < MIN_PROMPTS) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const scrollRect = scrollEl.getBoundingClientRect();
      const line = scrollRect.top + scrollRect.height * 0.4;
      const els = scrollEl.querySelectorAll<HTMLElement>("[data-turn-id]");
      let current: string | null = null;
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) {
          current = el.dataset.turnId ?? null;
        } else {
          break;
        }
      }
      // Before the first turn crosses the line, treat the first as active.
      current ??= els[0]?.dataset.turnId ?? null;
      setActiveId((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };

    measure();
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [stick.scrollRef, promptCount]);

  // Keep the active row visible whenever the panel is open.
  useEffect(() => {
    if (!open || !activeId) return;
    panelRef.current
      ?.querySelector(`[data-timeline-row="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);

  if (promptCount < MIN_PROMPTS) return null;

  // --- interactions ----------------------------------------------------
  const scrollToTurn = (turnId: string) => {
    const scrollEl = stick.scrollRef.current;
    if (!scrollEl) return;
    // Scope to this view's scroller — side chat / pair chat render their
    // own [data-turn-id] elements elsewhere in the document.
    const el = scrollEl.querySelector<HTMLElement>(
      `[data-turn-id="${CSS.escape(turnId)}"]`,
    );
    if (!el) return;
    // Release stick-to-bottom's at-bottom lock first, or its
    // ResizeObserver snaps the conversation back to the bottom while
    // content is still streaming.
    stick.stopScroll();
    const scrollRect = scrollEl.getBoundingClientRect();
    const top =
      scrollEl.scrollTop + el.getBoundingClientRect().top - scrollRect.top - 16;
    // scrollTo on the scroller itself — scrollIntoView may also scroll
    // ancestor containers.
    scrollEl.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  const enter = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  // Fixed 2px ticks; gap shrinks as the chat grows so the strip stays
  // under ~50vh. Long chats rely on the panel's own scroll instead.
  const gap = Math.max(2, Math.min(8, 280 / promptCount));

  return (
    // Single hover wrapper sized to its children (ticks column + the
    // panel when open). `right-3` (12px) keeps the strip off the
    // scrollbar lane — the chat's WebKit scrollbar lives at
    // right-0 in classic mode and floats at the right edge in
    // overlay mode, so the strip needs a few px of breathing
    // room on the right to not visually fuse with the thumb.
    // Wrapper height is auto, not inset-y-0 — that would make the
    // entire conversation a hover target. Centered vertically with
    // top-1/2 -translate-y-1/2 to keep the strip at the visual
    // middle of the scroller regardless of scroll position.
    <div
      className={cn(
        "absolute right-3 top-1/2 z-20 -translate-y-1/2",
        "flex flex-row-reverse items-center",
      )}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <div
        // The ticks column. Limited to ~50vh so a chat with 100+ turns
        // still leaves room for the conversation itself. pl-2 widens
        // the click target horizontally beyond the 2-px ticks so the
        // strip is easy to hit.
        className={cn(
          "flex max-h-[40vh] flex-col items-end overflow-hidden py-1 pl-2",
          "transition-opacity duration-150",
          open ? "opacity-0" : "opacity-100",
        )}
        style={{ gap: `${gap}px` }}
        aria-hidden={open}
      >
        {prompts.map((turn) => (
          <button
            key={turn.id}
            type="button"
            tabIndex={-1}
            aria-label={turn.promptText.slice(0, 80)}
            onClick={() => scrollToTurn(turn.id)}
            className={cn(
              "h-0.5 rounded-full transition-all duration-150",
              turn.id === activeId ? "w-4 bg-fg" : "w-2.5 bg-fg/20",
            )}
          />
        ))}
      </div>

      {open && (
        <div
          ref={panelRef}
          // Flex sibling of the ticks column (flex-row-reverse puts
          // panel to the LEFT of the ticks). ml-2 visually separates
          // the two. max-h matches the ticks column so the hover
          // region stays tight (one max-h, not ticks+panel stacked).
          className={cn(
            "max-h-[40vh] w-72 overflow-y-auto",
            "rounded-xl border border-border/60 bg-bg-surface/95 backdrop-blur",
            "shadow-lg p-1 ml-2",
          )}
          role="listbox"
          aria-label="Conversation timeline"
        >
          {prompts.map((turn) => (
            <button
              key={turn.id}
              type="button"
              data-timeline-row={turn.id}
              role="option"
              aria-selected={turn.id === activeId}
              onClick={() => scrollToTurn(turn.id)}
              className={cn(
                "block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm",
                turn.id === activeId
                  ? "bg-fg/8 text-fg"
                  : "text-fg-muted hover:bg-fg/5 hover:text-fg",
              )}
            >
              {turn.promptText}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
