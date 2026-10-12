import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  pathname: "/chat/sess-1" as string | undefined,
  active: null as { id: string; agent_id?: string } | null,
  throwOnRoute: false,
  throwOnSession: false,
}));

vi.mock("@/router", () => ({
  router: {
    get state() {
      if (harness.throwOnRoute) throw new Error("router gone");
      return { location: { pathname: harness.pathname } };
    },
  },
}));

vi.mock("@/lib/session-store", () => ({
  sessionStore: {
    active: () => {
      if (harness.throwOnSession) throw new Error("store gone");
      return harness.active;
    },
  },
}));

import { rendererCrashContext } from "./renderer-crash-context";

beforeEach(() => {
  harness.pathname = "/chat/sess-1";
  harness.active = { id: "sess-1", agent_id: "claude-acp" };
  harness.throwOnRoute = false;
  harness.throwOnSession = false;
});

describe("rendererCrashContext", () => {
  it("reads the current route and active session", () => {
    expect(rendererCrashContext()).toEqual({
      route: "/chat/sess-1",
      session: { id: "sess-1", agentId: "claude-acp" },
    });
  });

  it("omits session fields that are absent", () => {
    harness.active = { id: "sess-2" };
    expect(rendererCrashContext().session).toEqual({
      id: "sess-2",
      agentId: undefined,
    });
  });

  it("returns undefined context pieces when nothing is active", () => {
    harness.pathname = undefined;
    harness.active = null;
    expect(rendererCrashContext()).toEqual({
      route: undefined,
      session: undefined,
    });
  });

  it("survives a half-initialized router and session store", () => {
    harness.throwOnRoute = true;
    harness.throwOnSession = true;
    expect(rendererCrashContext()).toEqual({
      route: undefined,
      session: undefined,
    });
  });
});
