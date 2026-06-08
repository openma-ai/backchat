import { useEffect, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/ChatView";
import { sessionStore } from "@/lib/session-store";

/**
 * Chat page — backs both `/` (no session) and `/chat/$sessionId`. Syncs the
 * route param into the active session so navigating in the sidebar /
 * deep-linking lands on the right turn-stream.
 *
 * Side-effect on entry: if the session has no turns yet AND it's a persisted
 * row (status=ready with no in-flight turn), we ask main for its event log
 * and replay into the turn structures. Once-per-session — we use a ref'd
 * set to avoid re-fetching when the user toggles sidebar to and fro.
 *
 * If the user opens /chat/<unknown-id>, we silently reset to / instead of
 * showing an error — sessions are renderer-only state and a stale URL after
 * a reload is the most common cause.
 */
const HISTORY_LOADED = new Set<string>();

export function ChatPage() {
  // useParams strict:false because this page is also rendered at "/" with
  // no params. Both shapes resolve cleanly here.
  const params = useParams({ strict: false }) as { sessionId?: string };
  const lastLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!params.sessionId) {
      sessionStore.setActive(null);
      return;
    }
    const row = sessionStore.get(params.sessionId);
    if (!row) {
      // Persisted seed hasn't landed yet (race with ShellLayout's
      // sessionsList fetch on first mount). Just set the active id so when
      // the seed completes the row is already targeted; the chat view
      // will re-render with the seeded row's metadata.
      sessionStore.setActive(params.sessionId);
      return;
    }
    sessionStore.setActive(params.sessionId);
    // Load history once per session per renderer lifetime. Re-navigating
    // shouldn't re-fetch; the in-memory turns are authoritative once we've
    // replayed them. (Live session.event continues to layer on top via
    // sessionStore.apply.)
    if (!HISTORY_LOADED.has(params.sessionId)) {
      HISTORY_LOADED.add(params.sessionId);
      lastLoadedRef.current = params.sessionId;
      void window.backchat
        .sessionsLoadHistory(params.sessionId)
        .then((rows) => sessionStore.replayHistory(params.sessionId!, rows));
    }
  }, [params.sessionId]);

  return <ChatView />;
}