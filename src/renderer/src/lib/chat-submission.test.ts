import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  chatIdleDeliveryMeta,
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
    expect(resolveWorkspaceMode("project")).toBe("project");
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
