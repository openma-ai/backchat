import { sessionStore } from "./session-store";

export async function reconnectAuthenticatedSession(sessionId?: string): Promise<void> {
  if (!sessionId || sessionStore.get(sessionId)?.status === "draft") return;
  // Credentials belong to the next runtime initialization. Reuse the existing
  // session identity, and leave its failed turn/draft alone; never replay input.
  const result = await window.backchat.sessionRestart({ session_id: sessionId, mode: "now" });
  if (result.status !== "restarted")
    throw new Error("The session is still running. Check sign-in again when it stops.");
  sessionStore.clearAuthRequired(sessionId);
}
