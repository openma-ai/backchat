import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenmaAccount } from "./openma-account.js";
import { OpenmaProjectEnvironments } from "./openma-project-environments.js";
import { OpenmaProjectService } from "./openma-project-service.js";
import type { ProjectInfo } from "../shared/projects.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const project: ProjectInfo = { id: "p", name: "App", primary_folder: "/work/app", source_folders: ["/work/app"], created_at: 1, updated_at: 1 };

async function setup(hosting: "backchat" | "external" = "backchat") {
  const directory = await mkdtemp(join(tmpdir(), "backchat-project-service-"));
  const bindings = new OpenmaProjectEnvironments(join(directory, "bindings.db"), () => project);
  cleanup.push(async () => { bindings.close(); await rm(directory, { recursive: true, force: true }); });
  const state = { offline: false, writes: 0, env: { id: "env", name: "App", config: { type: "self_hosted" }, archived_at: null, metadata: { custom: "kept" } as Record<string, string> } };
  const fetchImpl: typeof fetch = async (url, init) => {
    const req = new Request(url, init);
    if (new URL(req.url).pathname === "/v1/oma/me") return Response.json({ user: { id: "user", email: "user@example.com", name: "User" }, tenant: { id: "team" }, tenants: [{ id: "team", name: "Team", role: "owner" }] });
    expect(req.headers.get("x-api-key")).toBe("secret");
    expect(req.headers.get("x-active-tenant")).toBe("team");
    if (state.offline) throw new Error("offline");
    if (req.method === "POST") { state.writes++; state.env.metadata = (await req.json() as { metadata: Record<string, string> }).metadata; }
    return Response.json(state.env);
  };
  const account = new OpenmaAccount({ directory, fetch: fetchImpl, authorize: async () => ({ user: "user", tokens: [{ tenant_id: "team", tenant_name: "Team", role: "owner", token: "secret", key_id: "key" }] }) });
  await account.login("https://app.openma.ai");
  const service = new OpenmaProjectService({ account, bindings, project: () => project, fetchImpl, runner: () => ({ enabled: true, hosting, status: "online", machineId: "machine", runtimeId: "runtime" }) });
  return { service, state, binding: { projectId: "p", environmentId: "env", runtimeId: "runtime" } };
}

describe("OpenMA project linking", () => {
  it("does not replace an external daemon's directory configuration with a Backchat project", async () => {
    const { service, state, binding } = await setup("external");
    await expect(service.link(binding)).rejects.toThrow(/external|daemon/i);
    expect(state.env.metadata).toEqual({ custom: "kept" });
    expect(service.list()).toEqual([]);
  });
  it("only links directories on this runner and preserves unrelated environment metadata", async () => {
    const { service, state, binding } = await setup();
    await expect(service.link({ ...binding, runtimeId: "other-machine" })).rejects.toThrow(/machine/i);
    expect(state.writes).toBe(0);
    await service.link(binding);
    expect(state.env.metadata).toEqual({ custom: "kept", "backchat.runtime_id": "runtime", "backchat.project_id": "p", "backchat.project_name": "App" });
    expect(service.list()).toEqual([binding]);
    expect(JSON.stringify(state.env.metadata)).not.toContain("/work/app");
  });

  it("stops new local tasks immediately when unlinking offline and allows server cleanup to be retried", async () => {
    const { service, state, binding } = await setup();
    await service.link(binding);
    state.offline = true;
    await expect(service.unlink(binding)).rejects.toThrow(/connection/i);
    expect(service.list()).toEqual([]);
    state.offline = false;
    await service.unlink(binding);
    expect(state.env.metadata).toEqual({ custom: "kept" });
  });
});
