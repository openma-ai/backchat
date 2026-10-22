import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import {
  clearSessionSearchJump,
  loadOlderHistory,
  peekSessionSearchJump,
} from "@/lib/history-paging";
import { sessionStore, type Turn } from "@/lib/session-store";

const PAINTED_SESSION_IDS = new Set<string>();

/**
 * Tracks whether a persisted session's first screen has settled so re-visiting
 * an already-rendered session does not flash an overlay or clobber scroll memory.
 */
export function useSessionFirstScreenPaint({
  persistedSessionId,
  historyPending,
  transcriptRef,
}: {
  persistedSessionId: string | null;
  historyPending: boolean;
  transcriptRef?: RefObject<HTMLElement | null>;
}): boolean {
  const [paintedSessionId, setPaintedSessionId] = useState<string | null>(null);
  const alreadyPainted =
    !!persistedSessionId && PAINTED_SESSION_IDS.has(persistedSessionId);
  const loadingFirstScreen =
    !!persistedSessionId &&
    (historyPending ||
      (!alreadyPainted && paintedSessionId !== persistedSessionId));

  useLayoutEffect(() => {
    if (!persistedSessionId || historyPending) {
      setPaintedSessionId(null);
      return;
    }
    if (PAINTED_SESSION_IDS.has(persistedSessionId)) {
      setPaintedSessionId(persistedSessionId);
      return;
    }
    let revealFrame = 0;
    const layoutFrame = requestAnimationFrame(() => {
      const scroller = transcriptRef?.current?.closest(".chat-scrollbar");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      revealFrame = requestAnimationFrame(() => {
        PAINTED_SESSION_IDS.add(persistedSessionId);
        setPaintedSessionId(persistedSessionId);
      });
    });
    return () => {
      cancelAnimationFrame(layoutFrame);
      cancelAnimationFrame(revealFrame);
    };
  }, [persistedSessionId, historyPending, transcriptRef]);

  return loadingFirstScreen;
}

/**
 * Resolves pending CommandPalette search jumps by paging older history windows
 * when the target seq precedes the loaded window, then scrolling and highlighting
 * the matching turn.
 */
export function useSessionSearchJump({
  sessionId,
  loadingFirstScreen,
  transcriptTurns,
  transcriptRef,
}: {
  sessionId: string | undefined;
  loadingFirstScreen: boolean;
  transcriptTurns: readonly Turn[];
  transcriptRef: RefObject<HTMLElement | null>;
}): void {
  useEffect(() => {
    if (!sessionId || loadingFirstScreen) return;
    const jump = peekSessionSearchJump(sessionId);
    if (!jump) return;
    const win = sessionStore.historyWindowFor(sessionId);
    if (
      win &&
      win.hasMore &&
      !win.loading &&
      win.oldestSeq !== undefined &&
      jump.seq > 0 &&
      jump.seq < win.oldestSeq
    ) {
      void loadOlderHistory(sessionId);
      return;
    }
    const needle = jump.query.toLowerCase();
    const candidates = transcriptTurns.filter(
      (turn) =>
        needle.length > 0 &&
        (turn.promptText.toLowerCase().includes(needle) ||
          turn.assistantText.toLowerCase().includes(needle)),
    );
    const pool = candidates.length > 0 ? candidates : transcriptTurns;
    const matched = [...pool].sort(
      (a, b) =>
        Math.abs((a.startedAt ?? 0) - jump.ts) -
        Math.abs((b.startedAt ?? 0) - jump.ts),
    )[0];
    clearSessionSearchJump(sessionId);
    if (!matched) return;
    const frame = requestAnimationFrame(() => {
      const el = transcriptRef.current?.querySelector<HTMLElement>(
        `[data-turn-id="${CSS.escape(matched.id)}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.dataset.searchHighlight = "true";
      window.setTimeout(() => {
        delete el.dataset.searchHighlight;
      }, 1800);
    });
    return () => cancelAnimationFrame(frame);
  }, [sessionId, loadingFirstScreen, transcriptTurns, transcriptRef]);
}
