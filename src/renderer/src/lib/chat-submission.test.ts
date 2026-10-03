import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  chatIdleDeliveryMeta,
  resolveDraftStartWorkspace,
  resolveProjectScopedPickedCwd,
  resolveWorkspaceMode,
  resolveChatFork,
  resolveChatStartCwd,
  resolveChatSubmitAgentId,
} from "./chat-submission";

describe("chat submission decisions", () => {
  it("chains prompt delivery directly from the completed start IPC", () => {
    const source = readFileSync(new URL("./chat-submission.ts", import.meta.url), "utf8");
    expect(source).toContain("await window.backchat.sessionStart({");
    expect(source).not.toContain("waitForSessionReady");
    expect(source).toContain('startResult.status !== "ready"');
    expect(source.indexOf("await window.backchat.sessionStart({")).toBeLessThan(
      source.indexOf("await window.backchat.sessionPrompt({"),
    );
  });

  it("uses selected and picked agents only for draft targets", () => {
    expect(resolveChatSubmitAgentId({
      target: null,
      selectedAgentId: "selected",
      pickedAgentId: "picked",
    })).toBe("selected");
    expect(resolveChatSubmitAgentId({
      target: { status: "draft", agent_id: "draft-agent" },
      pickedAgentId: "picked",
    })).toBe("picked");
    expect(resolveChatSubmitAgentId({
      target: { status: "draft", agent_id: "draft-agent" },
    })).toBe("draft-agent");
    expect(resolveChatSubmitAgentId({
      target: { status: "running", agent_id: "bound-agent" },
      selectedAgentId: "selected",
      pickedAgentId: "picked",
    })).toBe("bound-agent");
  });

  it("chooses and trims the first configured draft workspace", () => {
    expect(resolveChatStartCwd({
      pickedCwd: " /picked ",
      chosenCwd: "/chosen",
      sessionCwd: "/session",
    })).toBe("/picked");
    expect(resolveChatStartCwd({
      pickedCwd: " ",
      chosenCwd: " /chosen ",
      sessionCwd: "/session",
    })).toBe("/chosen");
    expect(resolveChatStartCwd({
      pickedCwd: null,
      chosenCwd: "",
      sessionCwd: " ",
    })).toBeUndefined();
  });

  it("ignores stale composer cwd unless the draft explicitly owns a project", () => {
    expect(resolveProjectScopedPickedCwd("none", "/old-project")).toBeUndefined();
    expect(resolveProjectScopedPickedCwd("project", " /chosen-project ")).toBe(
      "/chosen-project",
    );
  });

  it("maps draft ownership to an explicit main-process workspace policy", () => {
    expect(resolveWorkspaceMode("none")).toBe("managed");
    // Live workspace by default; a chosen workspace switches to checkouts.
    expect(resolveWorkspaceMode("project")).toBe("project");
    expect(resolveWorkspaceMode("project", false, true, "ws-feature-1a2b")).toBe("worktree");
    expect(resolveWorkspaceMode("project", false, true, null)).toBe("project");
    expect(resolveWorkspaceMode("project", false, false)).toBe("managed");
    expect(resolveWorkspaceMode(undefined, true)).toBe("inherited");
    expect(resolveWorkspaceMode(undefined)).toBeUndefined();
  });

  it("only forks from a parent with fork inheritance and an ACP session id", () => {
    expect(resolveChatFork({
      inheritance: "fork",
      parentAcpSessionId: "acp-parent",
    })).toEqual({ acp_session_id: "acp-parent" });
    expect(resolveChatFork({
      inheritance: "fresh",
      parentAcpSessionId: "acp-parent",
    })).toBeUndefined();
    expect(resolveChatFork({
      inheritance: "fork",
    })).toBeUndefined();
    expect(resolveChatFork(undefined)).toBeUndefined();
    expect(resolveChatFork({
      inheritance: "fork",
      parentAcpSessionId: "acp-parent",
      point: {
        messageId: "assistant-1",
        messageText: "Hello",
        messageOccurrence: 1,
      },
    })).toEqual({
      acp_session_id: "acp-parent",
      point: {
        messageId: "assistant-1",
        messageText: "Hello",
        messageOccurrence: 1,
      },
    });
  });

  it("keeps a managed fork out of the last project, including message fork", () => {
    const managed = {
      cwd: "/Users/mini/.oma/sessions/sess-parent",
      projectScope: "none" as const,
      forkParent: {
        parentSessionId: "sess-parent",
        parentAcpSessionId: "acp-parent",
        inheritance: "fork" as const,
      },
    };
    expect(resolveDraftStartWorkspace({
      target: managed,
      isSide: false,
      pickedCwd: "/tmp/last-project",
    })).toEqual({
      workspace_mode: "managed",
      parent_session_id: "sess-parent",
      fork_kind: "session",
    });
    expect(resolveDraftStartWorkspace({
      target: {
        ...managed,
        chosenCwd: "/tmp/last-project",
        forkParent: {
          ...managed.forkParent,
          point: {
            messageId: "assistant-1",
            messageText: "Hello",
            messageOccurrence: 1,
          },
        },
      },
      isSide: false,
      pickedCwd: "/tmp/last-project",
    })).toEqual({
      workspace_mode: "managed",
      parent_session_id: "sess-parent",
      fork_kind: "message",
    });
  });

  it("keeps a project fork on the same project and ignores a stale picked directory", () => {
    expect(resolveDraftStartWorkspace({
      target: {
        cwd: "/work/app",
        chosenCwd: "/work/app",
        projectScope: "project",
        projectId: "proj-app",
        additionalDirectories: ["/work/docs"],
        workspaceId: "ws-feature",
        forkParent: {
          parentSessionId: "sess-parent",
          parentAcpSessionId: "acp-parent",
          inheritance: "fork",
        },
      },
      isSide: false,
      pickedCwd: "/tmp/last-project",
    })).toEqual({
      workspace_mode: "worktree",
      cwd: "/work/app",
      additional_directories: ["/work/docs"],
      project_id: "proj-app",
      workspace_id: "ws-feature",
      parent_session_id: "sess-parent",
      fork_kind: "session",
    });
  });

  it("keeps a side chat on the parent cwd instead of the last project", () => {
    expect(resolveDraftStartWorkspace({
      target: {
        cwd: "/Users/mini/.oma/sessions/sess-parent",
        projectScope: "none",
        sideParent: {
          parentSessionId: "sess-parent",
          parentAcpSessionId: "acp-parent",
          inheritance: "fork",
        },
      },
      isSide: true,
      pickedCwd: "/tmp/last-project",
    })).toMatchObject({
      workspace_mode: "inherited",
      cwd: "/Users/mini/.oma/sessions/sess-parent",
      parent_session_id: "sess-parent",
      fork_kind: "session",
    });
    expect(resolveDraftStartWorkspace({
      target: {
        cwd: "/work/app",
        chosenCwd: "/work/app",
        projectScope: "project",
        projectId: "proj-app",
        sideParent: {
          parentSessionId: "sess-parent",
          parentAcpSessionId: "acp-parent",
          inheritance: "fork",
        },
      },
      isSide: true,
      pickedCwd: "/tmp/last-project",
    })).toMatchObject({
      workspace_mode: "inherited",
      cwd: "/work/app",
      project_id: "proj-app",
      parent_session_id: "sess-parent",
      fork_kind: "session",
    });
  });

  it("uses turn-end delivery for an idle session without degradation", () => {
    expect(chatIdleDeliveryMeta("steer")).toEqual({
      intent: "steer",
      requestedDelivery: "turn_end",
      effectiveDelivery: "turn_end",
      degraded: false,
    });
  });
});
