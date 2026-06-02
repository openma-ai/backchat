import { useEffect } from "react";
import { useParams } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/ChatView";
import { sessionStore } from "@/lib/session-store";

/**
 * Chat page — backs both `/` (no session) and `/chat/$sessionId`. Syncs the
 * route param into the active session so navigating in the sidebar /
 * deep-linking lands on the right turn-stream.
 *
 * If the user opens /chat/<unknown-id>, we silently reset to / instead of
 * showing an error — sessions are renderer-only state and a stale URL after
 * a reload is the most common cause.
 */
export function ChatPage() {
  // useParams strict:false because this page is also rendered at "/" with
  // no params. Both shapes resolve cleanly here.
  const params = useParams({ strict: false }) as { sessionId?: string };

  useEffect(() => {
    if (params.sessionId) {
      const exists = sessionStore.get(params.sessionId);
      if (exists) {
        sessionStore.setActive(params.sessionId);
      } else {
        sessionStore.setActive(null);
      }
    } else {
      sessionStore.setActive(null);
    }
  }, [params.sessionId]);

  return <ChatView />;
}