import { describe, expect, it } from "vitest";
import type { SessionRow } from "./session-types";
import {
  externalCoordinatorNodes,
  externalCoordinatorSessionIds,
} from "./external-coordinator-tree";

function row(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: overrides.id ?? "sess",
    agent_id: "codex-acp",
    cwd: "/work",
    acp_session_id: "",
    label: overrides.label ?? "Chat",
    status: "ready",
    createdAt: 1,
    ...overrides,
  };
}

const coordinators = [{
  id: "coord-1",
  project_id: "proj-1",
  name: "cursor killer",
  created_at: 1,
}];

describe("external coordinator tree", () => {
  it("nests a client's sessions and tasks under that coordinator only", () => {
    const external = row({
      id: "external",
      projectId: "proj-1",
      externalClient: "cursor killer",
      label: "EVIDENCE_HELLO",
    });
    const builtin = row({ id: "builtin", projectId: "proj-1", label: "Project chat" });
    const nodes = externalCoordinatorNodes("proj-1", [external, builtin], coordinators, [{
      id: "task-1",
      project_id: "proj-1",
      coordinator_id: "coord-1",
      coordinator_name: "cursor killer",
      command_id: "cmd-1",
      type: "delegate",
      text: "Review the branch",
      worker_id: "review-1",
      status: "submitted",
      created_at: 2,
    }]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.sessions.map((session) => session.id)).toEqual(["external"]);
    expect(nodes[0]?.tasks.map((task) => task.text)).toEqual(["Review the branch"]);
    expect(externalCoordinatorSessionIds([external, builtin], coordinators)).toEqual(new Set(["external"]));
    expect(externalCoordinatorSessionIds([external, builtin], [])).toEqual(new Set());
  });
});
