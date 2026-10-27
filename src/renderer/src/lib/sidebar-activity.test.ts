import { describe, expect, it } from "vitest";
import { getSessionSidebarStatus, aggregateSidebarStatus } from "./sidebar-activity";
import type { SessionRow } from "./session-types";

const row = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  id: "chat", agent_id: "codex-acp", cwd: "/repo", acp_session_id: "acp",
  label: "Chat", status: "ready", createdAt: 1, ...overrides,
});

describe("sidebar activity", () => {
  it("keeps attention requests above running and unread states", () => {
    expect(getSessionSidebarStatus(row({ status: "running", unread: true, pendingAsks: [{ kind: "permission", ask: {} as never }] }))).toBe("approval");
    expect(getSessionSidebarStatus(row({ status: "running", pendingAsks: [{ kind: "fsWrite", ask: {} as never }] }))).toBe("approval");
    expect(getSessionSidebarStatus(row({ pendingAsks: [{ kind: "elicitation", ask: {} as never }] }))).toBe("approval");
  });
  it("shows turn failures even when the session is ready for another prompt", () => {
    expect(getSessionSidebarStatus(row({ lastError: "Request failed", unread: true }))).toBe("error");
    expect(getSessionSidebarStatus(row({ status: "errored" }))).toBe("error");
    expect(getSessionSidebarStatus(row({ authRequired: true }))).toBe("error");
  });
  it("does not mistake old errors or unread results for a new running turn", () => {
    expect(getSessionSidebarStatus(row({ status: "running", lastError: "Old error", unread: true }))).toBe("running");
    expect(getSessionSidebarStatus(row({ status: "starting" }))).toBe("running");
  });
  it("clears completed unread only for the session being viewed", () => {
    expect(getSessionSidebarStatus(row({ unread: true }))).toBe("unread");
    expect(getSessionSidebarStatus(row({ unread: true }), true)).toBe("idle");
    expect(getSessionSidebarStatus(row())).toBe("idle");
  });
  it("propagates the most actionable descendant regardless of order", () => {
    expect(aggregateSidebarStatus(["unread", "running", "error", "approval"])).toBe("approval");
    expect(aggregateSidebarStatus(["approval", "error", "running"])).toBe("approval");
    expect(aggregateSidebarStatus(["running", "error", "unread"])).toBe("error");
    expect(aggregateSidebarStatus(["unread", "running"])).toBe("running");
    expect(aggregateSidebarStatus(["idle", "unread"])).toBe("unread");
    expect(aggregateSidebarStatus([])).toBe("idle");
  });
});

describe("sidebar activity follows canonical session state", () => {
  it("keeps running through assistant output, and clears completed unread on open", async () => {
    const { SessionStore } = await import("./session-store");
    const store = new SessionStore();
    store.apply({ type: "session.ready", session_id: "background", acp_session_id: "acp", agent_id: "codex-acp", cwd: "/repo" });
    store.setActive(null);
    store.registerTurn("turn", "background", "Work");
    store.apply({ type: "session.event", session_id: "background", turn_id: "turn", event: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Output is not completion" } } });
    expect(getSessionSidebarStatus(store.get("background")!)).toBe("running");
    store.apply({ type: "session.complete", session_id: "background", turn_id: "turn", stop_reason: "end_turn" });
    expect(getSessionSidebarStatus(store.get("background")!)).toBe("unread");
    store.setActive("background");
    expect(getSessionSidebarStatus(store.get("background")!)).toBe("idle");
  });
  it("returns from approval to running when the actual pending request is answered", async () => {
    const { SessionStore } = await import("./session-store");
    const store = new SessionStore();
    store.apply({ type: "session.ready", session_id: "approval", acp_session_id: "acp", agent_id: "codex-acp", cwd: "/repo" });
    store.registerTurn("turn", "approval", "Work");
    store.enqueueAsk("approval", { kind: "permission", ask: { requestId: "permission" } as never });
    expect(getSessionSidebarStatus(store.get("approval")!)).toBe("approval");
    store.dequeueAsk("approval", "permission");
    expect(getSessionSidebarStatus(store.get("approval")!)).toBe("running");
  });
});
