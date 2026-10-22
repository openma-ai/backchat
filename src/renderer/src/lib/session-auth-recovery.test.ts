import { afterEach, expect, it, vi } from "vitest";
import { SessionStore, sessionStore } from "./session-store";
import { composerAuthNeeded } from "./composer-harness-state";
import { reconnectAuthenticatedSession } from "./session-auth-recovery";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps authentication blocked until the original session has restarted", async () => {
  let finish!: () => void;
  const restart = vi.fn(() => new Promise<{ session_id: string; status: "restarted" }>(resolve => {
    finish = () => resolve({ session_id: "original", status: "restarted" });
  }));
  const clear = vi.spyOn(sessionStore, "clearAuthRequired");
  vi.stubGlobal("window", { backchat: { sessionRestart: restart } });
  const pending = reconnectAuthenticatedSession("original");
  expect(restart).toHaveBeenCalledWith({ session_id: "original", mode: "now" });
  expect(clear).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(clear).toHaveBeenCalledWith("original");
});

it.each(["failed", "pending"])("keeps authentication blocked when reconnect is %s", async (status) => {
  const restart = vi.fn(async () => {
    if (status === "failed") throw new Error("Resume failed");
    return { session_id: "original", status: "pending" };
  });
  const clear = vi.spyOn(sessionStore, "clearAuthRequired");
  vi.stubGlobal("window", { backchat: { sessionRestart: restart } });
  await expect(reconnectAuthenticatedSession("original")).rejects.toThrow();
  expect(clear).not.toHaveBeenCalled();
});

it("does not start a runtime when signing in before a new conversation", async () => {
  const restart = vi.fn();
  vi.stubGlobal("window", { backchat: { sessionRestart: restart } });
  await reconnectAuthenticatedSession(undefined);
  expect(restart).not.toHaveBeenCalled();
});

it("blocks a configured session on an auth error without an auth payload and clears the historical block on ready", () => {
  const store = new SessionStore();
  const ready = {
    type: "session.ready" as const,
    session_id: "project-auth",
    acp_session_id: "remote-project-auth",
    agent_id: "codex-acp",
    cwd: "/tmp/project",
  };
  const agent = { auth: { status: "configured" } };
  store.apply(ready);
  store.apply({
    type: "session.error",
    session_id: ready.session_id,
    message: "Internal error",
    code: "auth_required",
  });
  const failed = store.get(ready.session_id);
  expect(failed).toMatchObject({
    authRequired: true,
    auth: { status: "needs-auth", message: "Internal error" },
  });
  expect(composerAuthNeeded(
    { status: "needs-auth", message: "Authentication required" },
    failed,
  )).toBe(true);

  store.apply(ready);
  const recovered = store.get(ready.session_id);
  expect(recovered).toMatchObject({ authRequired: false, auth: { status: "configured" } });
  // Project facts retain the original failed turn; the new runtime's successful
  // handshake supersedes that historical evidence without deleting it.
  expect(composerAuthNeeded(
    { status: "needs-auth", message: "Authentication required" },
    { ...recovered, authRequired: true },
  )).toBe(false);
});
