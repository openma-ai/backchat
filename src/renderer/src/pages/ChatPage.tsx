import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/ChatView";
import {
  ConversationErrorFallback,
  ConversationSurfaceLoader,
} from "@/components/chat/ConversationLoadingState";
import { sessionStore, useSessionStore, type SessionRow } from "@/lib/session-store";
import { openHistoryWindow } from "@/lib/history-paging";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

/**
 * Chat page — backs `/chat/$sessionId`. The cold-create `/` route is a
 * separate NewChatPage so draft layout cannot inherit transcript chrome.
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
const PREWARMED = new Set<string>();

export function ChatPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const activeId = useSessionStore(s => s.active()?.id);
  const params = useParams({ strict: false }) as { sessionId?: string };
  const routeSessionSelector = useMemo(() => {
    const sessionId = params.sessionId;
    return (s: typeof sessionStore) => (sessionId ? s.get(sessionId) : undefined);
  }, [params.sessionId]);
  const routeSession = useSessionStore(routeSessionSelector);
  const turnsCount = useSessionStore(
    useMemo(
      () => (s: typeof sessionStore) =>
        params.sessionId ? s.turnsFor(params.sessionId).length : 0,
      [params.sessionId],
    ),
  );
  const lastLoadedRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missingRouteTimedOut, setMissingRouteTimedOut] = useState(false);
  const remoteId = routeSession?.openma ? routeSession.id : undefined;

  useEffect(() => {
    setLoadError(null);
    setMissingRouteTimedOut(false);
  }, [params.sessionId]);

  useEffect(() => {
    if (!params.sessionId || routeSession) {
      setMissingRouteTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!sessionStore.get(params.sessionId!)) {
        setMissingRouteTimedOut(true);
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [params.sessionId, routeSession]);

  const loadRemoteTask = useCallback((taskId: string) => {
    let active = true;
    setLoadError(null);
    const subscriptionId = crypto.randomUUID();
    void window.backchat
      .openmaTaskOpen(taskId, subscriptionId)
      .then((snapshot) => {
        if (active) sessionStore.applyOpenmaSnapshot(snapshot);
      })
      .catch((error) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : "Couldn't open OpenMA task";
        setLoadError(message);
        toast.error(message);
      });
    return () => {
      active = false;
      void window.backchat.openmaTaskDetach(taskId, subscriptionId).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!remoteId) return;
    return loadRemoteTask(remoteId);
  }, [loadRemoteTask, remoteId]);

  const loadLocalHistory = useCallback((sessionId: string) => {
    lastLoadedRef.current = sessionId;
    setLoadError(null);
    void openHistoryWindow(sessionId)
      .then(() => {
        HISTORY_LOADED.add(sessionId);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Couldn't load history";
        setLoadError(message);
        toast.error(message);
      });
  }, []);

  useEffect(() => {
    if (!params.sessionId) {
      sessionStore.setActive(null);
      return;
    }
    const row = routeSession;
    if (!row) {
      // Persisted seed hasn't landed yet (race with ShellLayout's
      // sessionsList fetch on first mount). Just set the active id so when
      // the seed completes the row is already targeted; the chat view
      // will re-render with the seeded row's metadata.
      sessionStore.setActive(params.sessionId);
      return;
    }
    sessionStore.setActive(params.sessionId);
    if (row.openma) return;
    // Load history once per session per renderer lifetime. Re-navigating
    // shouldn't re-fetch; the in-memory turns are authoritative once we've
    // replayed them. (Live session.event continues to layer on top via
    // sessionStore.apply.) Only the newest page is fetched here; the chat
    // view pages older rows in as the user scrolls up.
    const sessionId = params.sessionId;
    if (!HISTORY_LOADED.has(sessionId)) {
      loadLocalHistory(sessionId);
    }
    const onFocusComposer = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest(".composer-card")) {
        return;
      }
      if (
        !PREWARMED.has(sessionId) &&
        prewarmSessionOnOpen(sessionStore.get(sessionId))
      ) {
        PREWARMED.add(sessionId);
      }
    };
    window.addEventListener("focusin", onFocusComposer);
    return () => window.removeEventListener("focusin", onFocusComposer);
  }, [loadLocalHistory, params.sessionId, routeSession]);

  if (params.sessionId && !routeSession && missingRouteTimedOut) {
    return (
      <ConversationErrorFallback
        message={t("chat.sessionErrored")}
        onRetry={() => void navigate({ to: "/" })}
      />
    );
  }
  if (params.sessionId && (!routeSession || activeId !== params.sessionId)) {
    return <ConversationSurfaceLoader label={t("chat.loadingHistory")} />;
  }
  if (loadError && turnsCount === 0 && params.sessionId) {
    return (
      <ConversationErrorFallback
        message={loadError}
        onRetry={() => {
          if (remoteId) {
            loadRemoteTask(remoteId);
          } else if (params.sessionId) {
            HISTORY_LOADED.delete(params.sessionId);
            loadLocalHistory(params.sessionId);
          }
        }}
      />
    );
  }
  return <ChatView />;
}

export function prewarmSessionOnOpen(row: SessionRow | undefined): boolean {
  if (
    !row ||
    row.openma ||
    row.status !== "ready" ||
    row.activeTurnId ||
    !row.acp_session_id ||
    typeof window === "undefined"
  ) {
    return false;
  }

  void window.backchat.sessionStart({
    session_id: row.id,
    agent_id: row.agent_id,
    cwd: row.cwd || undefined,
    additional_directories: row.additionalDirectories,
    project_id: row.projectId,
    workspace_id: row.workspaceId ?? undefined,
    resume: { acp_session_id: row.acp_session_id },
  });
  return true;
}
