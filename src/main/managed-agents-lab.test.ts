import { describe, expect, it } from "vitest";
import {
  runManagedAgentsLab,
  type ManagedAgentsLabRuntime,
} from "./managed-agents-lab.js";

function fakeRuntime(options?: { fail?: boolean }) {
  const cleanup: string[] = [];
  const runtime: ManagedAgentsLabRuntime = {
    verifyTunnelsUnsupported: async () => ({
      status: 501,
      type: "not_implemented",
      message: "MCP Tunnels are not supported by Open Managed Agents",
    }),
    createAgent: async () => ({ agentId: "agent-lab" }),
    createEnvironment: async () => ({ environmentId: "env-lab" }),
    createSession: async () => ({ sessionId: "sess-lab" }),
    prompt: async function* () {
      yield { type: "event_start", event: { type: "agent.message", id: "msg-lab" } };
      if (options?.fail) throw new Error("stream failed");
      yield { type: "event_delta", event_id: "msg-lab" };
      yield { type: "agent.message", id: "msg-lab" };
      yield { type: "session.status_idle" };
    },
    interrupt: async () => undefined,
    dispose: async (id) => {
      cleanup.push(`session:${id}`);
    },
    archiveAgent: async (id) => {
      cleanup.push(`agent:${id}`);
    },
    archiveEnvironment: async (id) => {
      cleanup.push(`environment:${id}`);
    },
  };
  return { runtime, cleanup };
}

describe("Managed Agents Lab run", () => {
  it("streams official events and cleans up temporary resources", async () => {
    const { runtime, cleanup } = fakeRuntime();
    const events: Array<{ kind: string; type?: string }> = [];

    const result = await runManagedAgentsLab(
      runtime,
      {
        model: "openai/gpt-5.4",
        prompt: "Write and run hello.py",
      },
      (event) => events.push(event),
    );

    expect(result).toEqual({
      agentId: "agent-lab",
      environmentId: "env-lab",
      sessionId: "sess-lab",
      eventTypes: [
        "event_start",
        "event_delta",
        "agent.message",
        "session.status_idle",
      ],
      tunnelStatus: "not_implemented",
    });
    expect(events.filter((event) => event.kind === "sdk_event").map((event) => event.type))
      .toEqual(result.eventTypes);
    expect(cleanup).toEqual([
      "session:sess-lab",
      "agent:agent-lab",
      "environment:env-lab",
    ]);
  });

  it("still cleans up when the SDK stream fails", async () => {
    const { runtime, cleanup } = fakeRuntime({ fail: true });

    await expect(
      runManagedAgentsLab(runtime, { model: "openai/gpt-5.4", prompt: "fail" }, () => {}),
    ).rejects.toThrow("stream failed");
    expect(cleanup).toEqual([
      "session:sess-lab",
      "agent:agent-lab",
      "environment:env-lab",
    ]);
  });
});
