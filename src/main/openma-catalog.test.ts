import { describe, expect, it } from "vitest";
import { loadOpenmaCatalog } from "./openma-catalog.js";
import type { OpenmaConnection } from "./openma-account.js";

const connection: OpenmaConnection = { baseUrl: "https://app.openma.ai", workspaceId: "workspace", apiKey: "secret", userId: "user" };
describe("OpenMA execution catalog", () => {
  it("joins runner agents to v1 bindings and marks this machine without duplicating it", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const req = new Request(url, init); requests.push(req);
      const path = new URL(req.url).pathname;
      if (path === "/v1/oma/runtimes") return Response.json({ runtimes: [
        { id: "here", machine_id: "this-machine", hostname: "Mac", status: "online", agents: [{ id: "codex-acp", binary: "/private/bin/codex" }] },
        { id: "there", machine_id: "another", hostname: "Server", status: "offline", agents: [{ id: "claude-acp" }] },
      ] });
      if (path === "/v1/agents") return Response.json({ data: [
        { id: "cloud-agent", name: "Cloud helper" },
        { id: "bound-agent", name: "Remote Codex", _oma: { runtime_binding: { runtime_id: "here", acp_agent_id: "codex-acp" } } },
      ], has_more: false });
      if (path === "/v1/environments") return Response.json({ data: [
        { id: "env", name: "Development", type: "environment", config: { type: "cloud" }, archived_at: null, created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z", description: null, metadata: {} },
        { id: "external", name: "External executor", type: "environment", config: { type: "self_hosted" }, archived_at: null, created_at: "2026-09-14T00:00:00Z", updated_at: "2026-09-14T00:00:00Z", description: null, metadata: { "backchat.runtime_id": "here", "backchat.project_name": "App" } },
      ], has_more: false });
      throw new Error(`Unexpected path ${path}`);
    };
    const catalog = await loadOpenmaCatalog({ connection, machineId: "this-machine", fetchImpl });
    expect(catalog.runners).toEqual([
      { id: "here", machineId: "this-machine", name: "Mac", status: "online", isLocal: true, agents: [{ id: "codex-acp", bindings: [{ id: "bound-agent", name: "Remote Codex" }] }] },
      { id: "there", machineId: "another", name: "Server", status: "offline", isLocal: false, agents: [{ id: "claude-acp", bindings: [] }] },
    ]);
    expect(catalog.cloudAgents).toEqual([{ id: "cloud-agent", name: "Cloud helper" }]);
    expect(catalog.environments).toEqual([
      { id: "env", name: "Development", type: "cloud", runtimeId: null },
      { id: "external", name: "External executor", type: "self_hosted", runtimeId: "here", projectName: "App" },
    ]);
    expect(JSON.stringify(catalog)).not.toContain("/private/");
    for (const req of requests) expect(req.headers.get("x-active-tenant")).toBe("workspace");
  });
});
