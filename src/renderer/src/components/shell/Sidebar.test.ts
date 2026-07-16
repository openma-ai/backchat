/// <reference types="node" />

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

import { groupSidebarSessions } from "./Sidebar";
import type { SessionRow } from "@/lib/session-store";

function row(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: overrides.id ?? "sess-1",
    agent_id: "codex-acp",
    cwd: overrides.cwd ?? "",
    acp_session_id: "",
    label: overrides.label ?? overrides.id ?? "Chat",
    status: "ready",
    createdAt: 1,
    ...overrides,
  };
}

describe("groupSidebarSessions", () => {
  it("renders a dedicated Pinned section before every other conversation section", () => {
    const source = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");

    const pinnedSection = source.indexOf("{pinned.length > 0 && (");
    const pairSection = source.indexOf("{pairs.length > 0 && (");
    const projectSection = source.indexOf("{projects.length > 0 && (");
    const chatSection = source.indexOf("{chats.length > 0 && (");

    expect(pinnedSection).toBeGreaterThan(-1);
    expect(source.slice(pinnedSection, pairSection)).toContain('t("sidebar.pinned")');
    expect(pinnedSection).toBeLessThan(pairSection);
    expect(pinnedSection).toBeLessThan(projectSection);
    expect(pinnedSection).toBeLessThan(chatSection);
  });

  it("groups unpinned project sessions by cwd", () => {
    const grouped = groupSidebarSessions([
      row({ id: "a", cwd: "/Users/minimax/oos-proj/openma" }),
      row({ id: "b", cwd: "/Users/minimax/oos-proj/openma" }),
      row({ id: "c", cwd: "/Users/minimax/oos-proj/trade-desk" }),
    ]);

    expect(grouped.projects.map((project) => ({
      label: project.label,
      ids: project.sessions.map((session) => session.id),
    }))).toEqual([
      { label: "openma", ids: ["a", "b"] },
      { label: "trade-desk", ids: ["c"] },
    ]);
    expect(grouped.chats).toEqual([]);
  });

  it("keeps pinned and app-managed session folders out of project groups", () => {
    const pinned = row({
      id: "pinned",
      cwd: "/Users/minimax/oos-proj/openma",
      pinnedAt: 123,
    });
    const appManaged = row({
      id: "managed",
      cwd: "/Users/minimax/.openma/sessions/sess-rfwr779u",
    });
    const noCwd = row({ id: "plain", cwd: "" });

    const grouped = groupSidebarSessions([pinned, appManaged, noCwd]);

    expect(grouped.pinned.map((session) => session.id)).toEqual(["pinned"]);
    expect(grouped.projects).toEqual([]);
    expect(grouped.chats.map((session) => session.id)).toEqual([
      "managed",
      "plain",
    ]);
  });
});
