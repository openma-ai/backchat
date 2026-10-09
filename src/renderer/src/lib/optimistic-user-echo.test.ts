import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store";
import type { Turn } from "./session-types";
import {
  clientIdFromUserEvent,
  failOptimisticEcho,
  insertOptimisticEcho,
  mergeOptimisticEchoes,
  projectMessageClientId,
  reconcileOptimisticEchoes,
  reopenOptimisticEcho,
  type OptimisticUserEcho,
} from "./optimistic-user-echo";

const echo = (
  clientId: string,
  text: string,
  state: OptimisticUserEcho["state"] = "pending",
): OptimisticUserEcho => ({
  clientId,
  text,
  createdAt: 1_000,
  state,
});

const persisted = (id: string, clientId: string | undefined, promptText: string): Turn => ({
  id,
  clientId,
  sessionId: "session",
  promptText,
  events: [],
  assistantText: "",
  thoughtText: "",
  status: "running",
  startedAt: 2_000,
});

describe("optimistic user echo", () => {
  it("inserts a pending message before any persisted turn exists", () => {
    const pending = insertOptimisticEcho([], echo("client-1", "Ship it"));
    expect(pending).toEqual([
      expect.objectContaining({ clientId: "client-1", text: "Ship it", state: "pending" }),
    ]);
    const turns = mergeOptimisticEchoes([], pending, "coordinator");
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: "echo:client-1",
      clientId: "client-1",
      promptText: "Ship it",
      sendState: "pending",
      status: "unknown",
    });
  });

  it("reconciles by client id and keeps a second send of the same text", () => {
    const echoes = [
      echo("client-1", "Ship it"),
      echo("client-2", "Ship it"),
    ];
    const reconciled = reconcileOptimisticEchoes(echoes, new Set(["client-1"]));
    expect(reconciled.map((item) => item.clientId)).toEqual(["client-2"]);
    const turns = mergeOptimisticEchoes(
      [persisted("turn-real", "client-1", "Ship it")],
      echoes,
    );
    expect(turns.map((turn) => turn.id)).toEqual(["turn-real", "echo:client-2"]);
    expect(turns.filter((turn) => turn.promptText === "Ship it")).toHaveLength(2);
  });

  it("marks a failed send and retries with the same client id", () => {
    const pending = insertOptimisticEcho([], echo("client-1", "Ship it"));
    const failed = failOptimisticEcho(pending, "client-1", "coordinator offline");
    expect(failed[0]).toMatchObject({
      clientId: "client-1",
      state: "failed",
      error: "coordinator offline",
    });
    expect(mergeOptimisticEchoes([], failed, "coordinator")[0]).toMatchObject({
      sendState: "failed",
      sendError: "coordinator offline",
      status: "error",
    });
    const retried = reopenOptimisticEcho(failed, "client-1");
    expect(retried[0]).toMatchObject({ clientId: "client-1", state: "pending", error: undefined });
    expect(failOptimisticEcho(pending, "other", "nope")).toBe(pending);
  });

  it("reads the client id from project trigger events and session user events", () => {
    expect(projectMessageClientId("proj", "proj:message:client-9")).toBe("client-9");
    expect(projectMessageClientId("proj", "other:message:client-9")).toBeUndefined();
    expect(clientIdFromUserEvent(
      { id: "proj:message:client-9", payload: { text: "Ship it" } },
      { projectId: "proj" },
    )).toBe("client-9");
    expect(clientIdFromUserEvent({
      event_id: "user-message:sess-1:turn-1",
      type: "user.message",
      turn_id: "turn-1",
      data: { text: "Hello", client_id: "turn-1", input_kind: "prompt" },
    }, { sessionId: "sess-1" })).toBe("turn-1");
  });
});

describe("session store optimistic send", () => {
  it("shows the prompt as pending, then accepts it, and keeps a failed send for retry", () => {
    const store = new SessionStore();
    store.registerStarting("sess-echo", "codex-acp", "Echo");
    store.registerTurn("turn-1", "sess-echo", "Hello");
    expect(store.turnsFor("sess-echo")[0]).toMatchObject({
      clientId: "turn-1",
      promptText: "Hello",
      sendState: "pending",
      status: "running",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-echo",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Working" },
      },
    });
    expect(store.turnsFor("sess-echo")[0]?.sendState).toBeUndefined();
    expect(store.turnsFor("sess-echo")[0]?.promptText).toBe("Hello");

    store.apply({
      type: "session.complete",
      session_id: "sess-echo",
      turn_id: "turn-1",
    });
    store.registerTurn("turn-2", "sess-echo", "Again");
    store.failSend("turn-2", "no such session");
    expect(store.turnsFor("sess-echo").find((turn) => turn.id === "turn-2")).toMatchObject({
      sendState: "failed",
      sendError: "no such session",
      status: "error",
      promptText: "Again",
    });
    store.reopenSend("turn-2");
    expect(store.turnsFor("sess-echo").find((turn) => turn.id === "turn-2")).toMatchObject({
      sendState: "pending",
      status: "running",
      clientId: "turn-2",
    });
  });

  it("moves a coordinator placeholder bubble onto the host turn id", () => {
    const store = new SessionStore();
    store.ensureBoundSession({
      id: "coordinator:p:scope",
      agentId: "codex-acp",
      cwd: "/tmp/p",
      label: "P",
      projectId: "p",
    });
    store.registerTurn("turn-client", "coordinator:p:scope", "Ship it");
    store.rebindSession("coordinator:p:scope", "host-session");
    store.apply({
      type: "session.prompt_accepted",
      session_id: "host-session",
      turn_id: "host-turn",
      client_id: "turn-client",
      text: "Ship it",
    });
    const turns = store.turnsFor("host-session");
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: "host-turn",
      clientId: "turn-client",
      promptText: "Ship it",
      sendState: undefined,
    });
    expect(store.turnsFor("coordinator:p:scope")).toEqual([]);
  });

  it("turns a prompt error with no agent output into a failed send", () => {
    const store = new SessionStore();
    store.registerStarting("sess-fail", "codex-acp", "Echo");
    store.registerTurn("turn-fail", "sess-fail", "Hello");
    store.apply({
      type: "session.error",
      session_id: "sess-fail",
      turn_id: "turn-fail",
      message: "Couldn't start the session",
    });
    expect(store.turnsFor("sess-fail")[0]).toMatchObject({
      sendState: "failed",
      sendError: "Couldn't start the session",
      promptText: "Hello",
    });
  });
});
