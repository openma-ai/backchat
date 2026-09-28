import { expect, it } from "vitest";
import { ProjectMcpBridge } from "./project-mcp.js";
import type { ProjectAgentBridge } from "./project-agent.js";
import type { ProjectWorkService } from "./project-work.js";

it("gives each worker only its own Goal capability while retaining coordinator controls", async () => {
  const bindings = new Map([
    ["worker-session", { projectId: "p", role: "worker", workThreadId: "worker:api" }],
    ["coordinator-session", { projectId: "p", role: "coordinator", workThreadId: "coordinator" }],
  ]);
  const service = {
    config: () => ({ controls: ["delegate", "steer", "cancel", "complete"] }),
    goalControl: (scopeId: string, workThreadId: string) => ({
      get: async () => ({
        id: "goal", scopeId, workThreadId, objective: "Fix retries", status: "active",
        tokensUsed: 0, timeUsedSeconds: 0, createdAt: "2026-09-22T00:00:00.000Z",
        updatedAt: "2026-09-22T00:00:00.000Z", revision: 1,
      }),
    }),
  } as unknown as ProjectWorkService;
  const bridge = new ProjectMcpBridge(service, { bindings } as unknown as ProjectAgentBridge);
  await bridge.start();
  try {
    const worker = bridge.descriptor("worker-session");
    expect(worker).toBeDefined();
    if (!worker || worker.type !== "http") throw new Error("Missing worker HTTP capability");
    const call = async (descriptor: typeof worker, method: string, params?: Record<string, unknown>, auth = true) => {
      const response = await fetch(descriptor.url, {
        method: "POST",
        headers: {
          "content-type": "application/json", accept: "application/json, text/event-stream",
          ...(auth ? Object.fromEntries(descriptor.headers?.map((header) => [header.name, header.value]) ?? []) : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }),
      });
      if (response.status !== 200) return { status: response.status, text: await response.text() };
      const text = await response.text();
      return JSON.parse(text.startsWith("event:") ? text.split("data: ")[1]!.trim() : text);
    };
    expect(await call(worker, "tools/list", undefined, false)).toMatchObject({ status: 401 });
    const workerInitialize = await call(worker, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(workerInitialize.result.protocolVersion).toBeTruthy();
    const workerTools = await call(worker, "tools/list");
    expect(workerTools.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_goal", "create_goal", "update_goal",
    ]);
    expect((await call(worker, "tools/call", { name: "get_goal", arguments: {} })).result.structuredContent).toMatchObject({
      goal: { scopeId: "p", workThreadId: "worker:api" },
    });
    for (const name of ["project.status", "project.delegate", "project.steer", "project.cancel", "project.complete"]) {
      const response = await call(worker, "tools/call", { name, arguments: {} });
      expect(response.result?.isError ?? response.error?.code).toBeDefined();
    }
    const coordinator = bridge.descriptor("coordinator-session");
    if (!coordinator || coordinator.type !== "http") throw new Error("Missing coordinator capability");
    expect((await call(coordinator, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })).result.protocolVersion).toBeTruthy();
    expect((await call(coordinator, "tools/list")).result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_goal", "create_goal", "update_goal", "project.status", "project.delegate", "project.steer", "project.cancel", "project.complete",
    ]);
    expect((await call(coordinator, "tools/call", { name: "get_goal", arguments: {} })).result.structuredContent).toMatchObject({
      goal: { scopeId: "p", workThreadId: "coordinator" },
    });
  } finally {
    await bridge.close();
  }
});
