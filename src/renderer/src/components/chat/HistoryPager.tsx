import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { loadOlderHistory } from "@/lib/history-paging";
import { sessionStore, useSessionStore } from "@/lib/session-store";

// Start fetching the previous page when the viewport comes within this
// many pixels of the top, so the user rarely hits a hard edge.
const TOP_THRESHOLD_PX = 320;
// After mount, markdown, images and fonts keep
// changing scrollHeight for a few frames. Pin the viewport during that window
// instead of letting the shared shell's `resize: "smooth"` animate each jump.
const SETTLE_MIN_MS = 300;
const SETTLE_MAX_MS = 1500;
const AT_BOTTOM_PX = 8;

/** Where the user left each session's transcript. The conversation subtree
 *  is keyed by session id and remounts on every switch, so this is the only
 *  memory of the scroll position. Renderer-lifetime, like HISTORY_LOADED. */
const SCROLL_MEMORY = new Map<string, { fromBottom: number; atBottom: boolean }>();

function pinDuringSettle(
  scrollEl: HTMLElement,
  target: () => number,
): () => void {
  let raf = 0;
  const started = performance.now();
  let lastHeight = scrollEl.scrollHeight;
  let stableFrames = 0;
  const tick = () => {
    raf = 0;
    const want = target();
    if (Math.abs(scrollEl.scrollTop - want) > 1) scrollEl.scrollTop = want;
    const height = scrollEl.scrollHeight;
    stableFrames = height === lastHeight ? stableFrames + 1 : 0;
    lastHeight = height;
    const elapsed = performance.now() - started;
    // Stop once the layout has been stable for a few frames past the minimum
    // window, or unconditionally at the cap.
    if (elapsed < SETTLE_MAX_MS && (elapsed < SETTLE_MIN_MS || stableFrames < 6)) {
      raf = requestAnimationFrame(tick);
    }
  };
  scrollEl.scrollTop = target();
  raf = requestAnimationFrame(tick);
  return () => { if (raf !== 0) cancelAnimationFrame(raf); };
}

/**
 * HistoryPager — pages older persisted rows into a session that was opened
 * as a tail window (see history-paging.ts). Must render INSIDE
 * <Conversation> so it can reach the scroll element through
 * useStickToBottomContext(), like ConversationTimeline.
 *
 * Two jobs:
 *  1. Land at the bottom the first time a windowed session renders.
 *  2. When the user scrolls near the top (or presses the pill), fetch the
 *     page before the oldest loaded row and keep the viewport anchored on
 *     the content it was showing — prepending grows scrollHeight, so
 *     scrollTop is shifted by the same delta after React commits.
 */
export function HistoryPager({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const stick = useStickToBottomContext();
  // The context object is recreated on every provider render; effects that
  // must run once per session read it through a ref instead of depending on it.
  const stickRef = useRef(stick);
  stickRef.current = stick;
  const selector = useMemo(
    () => (s: typeof sessionStore) => s.historyWindowFor(sessionId),
    [sessionId],
  );
  const window = useSessionStore(selector);
  const hasMore = window?.hasMore ?? false;
  const loading = window?.loading ?? false;
  const oldestSeq = window?.oldestSeq;

  // Scroll anchor captured right before a page is requested.
  const anchor = useRef<{ height: number; top: number } | null>(null);

  const requestOlder = useCallback(() => {
    if (!hasMore || loading) return;
    const scrollEl = stick.scrollRef.current;
    if (scrollEl) {
      anchor.current = { height: scrollEl.scrollHeight, top: scrollEl.scrollTop };
      // Release the at-bottom lock; otherwise the resize observer snaps the
      // conversation to the bottom as the older turns mount.
      stick.stopScroll();
    }
    void loadOlderHistory(sessionId).catch((error: unknown) => {
      anchor.current = null;
      toast.error(error instanceof Error ? error.message : "Couldn't load earlier messages");
    });
  }, [hasMore, loading, sessionId, stick]);

  // 1. Land where the user left off, or at the bottom for a first open.
  // StickToBottom is mounted with initial=false by the shared shell, so a
  // freshly replayed window otherwise sits at the top and then animates down
  // as late content lands. Pin through the settle window instead. Memory is
  // written only after a real user scroll: a pin that could not take effect
  // yet (pre-layout) must not be recorded as "at top".
  useLayoutEffect(() => {
    const stick = stickRef.current;
    const scrollEl = stick.scrollRef.current;
    if (!scrollEl) return;
    const saved = SCROLL_MEMORY.get(sessionId);
    // Anchor on the distance from the bottom: scrollHeight keeps growing for
    // a while after mount (markdown, images, fonts), so an
    // absolute top would be clamped by the not-yet-final height.
    const fromBottom = saved && !saved.atBottom ? saved.fromBottom : 0;
    if (fromBottom > 0) stick.stopScroll();
    else void stick.scrollToBottom({ animation: "instant" });
    const stop = pinDuringSettle(scrollEl, () =>
      Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight - fromBottom),
    );
    let userScrolled = false;
    const onUserScroll = () => { userScrolled = true; };
    scrollEl.addEventListener("wheel", onUserScroll, { passive: true });
    scrollEl.addEventListener("touchmove", onUserScroll, { passive: true });
    scrollEl.addEventListener("keydown", onUserScroll);
    return () => {
      stop();
      scrollEl.removeEventListener("wheel", onUserScroll);
      scrollEl.removeEventListener("touchmove", onUserScroll);
      scrollEl.removeEventListener("keydown", onUserScroll);
      // Only a real user scroll may change memory. Mount/unmount churn while
      // rows are still landing must not overwrite the last known position.
      if (!userScrolled) return;
      const distance = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      SCROLL_MEMORY.set(sessionId, {
        fromBottom: Math.max(0, distance),
        atBottom: distance <= AT_BOTTOM_PX,
      });
    };
  }, [sessionId]);

  // 2a. Preserve the viewport after older rows are prepended. oldestSeq
  // changes exactly when the store rebuilt turns from a larger window.
  useLayoutEffect(() => {
    const a = anchor.current;
    const scrollEl = stickRef.current.scrollRef.current;
    if (!a || !scrollEl) return;
    anchor.current = null;
    const delta = scrollEl.scrollHeight - a.height;
    if (delta > 0) scrollEl.scrollTop = a.top + delta;
  }, [oldestSeq]);

  // 2b. Auto-fetch near the top. Passive scroll listener + rAF, no
  // observers (see ConversationTimeline for why).
  useEffect(() => {
    const scrollEl = stick.scrollRef.current;
    if (!scrollEl || !hasMore) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      if (scrollEl.scrollTop <= TOP_THRESHOLD_PX) requestOlder();
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(check);
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    // A window that does not fill the viewport can never scroll to the top
    // edge; check once after the landing settle so it still pages in.
    const initial = globalThis.setTimeout(() => {
      if (scrollEl.scrollHeight - scrollEl.clientHeight <= TOP_THRESHOLD_PX) requestOlder();
    }, SETTLE_MIN_MS + 50);
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      globalThis.clearTimeout(initial);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [hasMore, requestOlder, stick.scrollRef]);

  // Paging is invisible: scrolling up simply keeps going. The only visible
  // trace is a thin progress line while a page is in flight, so a pause at
  // the top edge reads as "fetching" rather than "end of history".
  if (!hasMore || !loading) return null;
  return (
    <div
      role="status"
      aria-label={t("chat.loadingEarlier")}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px overflow-hidden"
    >
      <div className="history-progress h-full w-1/3 bg-fg/40" />
    </div>
  );
}
