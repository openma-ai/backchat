import { sessionStore } from "./session-store";

/** Rows per page. Persisted rows are mostly single-token stream chunks
 *  (a few characters each), so ~800 rows is a screen or two of rendered
 *  blocks while staying far below the tens of thousands of rows a long
 *  goal session accumulates. */
export const HISTORY_PAGE_ROWS = 800;

/** Open a persisted session from its newest rows. */
export async function openHistoryWindow(sessionId: string): Promise<void> {
  sessionStore.setHistoryPending(sessionId, true);
  try {
    const rows = await window.backchat.sessionsLoadHistory(sessionId, {
      limit: HISTORY_PAGE_ROWS,
    });
    sessionStore.replayHistoryWindow(sessionId, rows, {
      hasMore: rows.length >= HISTORY_PAGE_ROWS,
    });
  } finally {
    sessionStore.setHistoryPending(sessionId, false);
  }
}

/** Fetch the page before the oldest loaded row and prepend it. Resolves
 *  to true when rows were added. No-op while a page is already in flight
 *  or when the window already reaches the start of the log. */
export async function loadOlderHistory(sessionId: string): Promise<boolean> {
  const info = sessionStore.historyWindowFor(sessionId);
  if (!info || !info.hasMore || info.loading) return false;
  sessionStore.setHistoryLoading(sessionId, true);
  try {
    const rows = await window.backchat.sessionsLoadHistory(sessionId, {
      before_seq: info.oldestSeq,
      limit: HISTORY_PAGE_ROWS,
    });
    sessionStore.prependHistory(sessionId, rows, {
      hasMore: rows.length >= HISTORY_PAGE_ROWS,
    });
    return rows.length > 0;
  } catch (error) {
    sessionStore.setHistoryLoading(sessionId, false);
    throw error;
  }
}
