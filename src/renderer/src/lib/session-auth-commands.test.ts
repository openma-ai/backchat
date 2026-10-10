import { describe, expect, test } from "vitest";
import { createOpenMAEvent } from "@openma/common/session-events/openma";
import { SessionStore } from "./session-store";

describe("live auth slash commands", () => {
  test("drops login and logout from available_commands_update and the command catalogue", () => {
    const store = new SessionStore();
    store.apply({
      type: "session.ready",
      session_id: "sess-auth-commands",
      acp_session_id: "acp-auth-commands",
      agent_id: "claude-acp",
      cwd: "/tmp/project",
    });

    store.apply({
      type: "session.event",
      session_id: "sess-auth-commands",
      turn_id: "",
      event: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "login", description: "Log in" },
          { name: "status", description: "Status" },
          { name: "logout", description: "Log out" },
        ],
      },
    });
    expect(store.get("sess-auth-commands")?.availableCommands).toEqual([
      { name: "status", description: "Status" },
    ]);

    const base = {
      session_id: "sess-auth-commands",
      turn_id: "",
      source: { kind: "harness" as const, harness: "claude-acp", adapter: "acp" },
      occurred_at: "2026-10-10T00:00:00.000Z",
    };
    store.apply({
      type: "session.event",
      session_id: base.session_id,
      turn_id: base.turn_id,
      event: { sessionUpdate: "unknown_transport" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "commands-auth",
        type: "command_catalog.updated",
        data: {
          commands: [
            { name: "login", description: "Log in" },
            { name: "review", description: "Review" },
            { description: "unnamed" },
          ],
        },
      }),
    });
    expect(store.get("sess-auth-commands")?.availableCommands).toEqual([
      { name: "review", description: "Review" },
      { description: "unnamed" },
    ]);

    store.apply({
      type: "session.event",
      session_id: base.session_id,
      turn_id: base.turn_id,
      event: { sessionUpdate: "unknown_transport" },
      openma_event: createOpenMAEvent({
        ...base,
        event_id: "commands-empty",
        type: "command_catalog.updated",
        data: { commands: "not-a-list" },
      }),
    });
    expect(store.get("sess-auth-commands")?.availableCommands).toEqual([]);

    store.apply({
      type: "session.error",
      session_id: "sess-auth-commands",
      message: "Authentication required",
      code: "auth_required",
      auth: { status: "needs-auth", message: "Authentication required", supportsLogout: true },
    });
    expect(store.get("sess-auth-commands")).toMatchObject({
      status: "ready",
      authRequired: true,
      supportsLogout: true,
    });

    const draftId = store.newDraft();
    store.apply({
      type: "session.error",
      session_id: draftId,
      message: "Authentication required",
      code: "auth_required",
      auth: { status: "needs-auth", message: "Authentication required" },
    });
    expect(store.get(draftId)).toMatchObject({ status: "draft", authRequired: true });
    expect(store.get(draftId)?.supportsLogout).toBeUndefined();

    store.apply({
      type: "session.error",
      session_id: "sess-auth-commands",
      message: "agent missing",
    });
    expect(store.get("sess-auth-commands")?.status).toBe("errored");
  });
});
