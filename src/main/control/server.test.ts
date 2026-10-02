import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callControl } from "../../cli/client.mjs";
import { runCli } from "../../cli/backchat.mjs";
import { ExitCode } from "../../shared/control-protocol.js";
import { closeSessionDb, openSessionDb } from "../sql-store.js";
import { ManagedWorktreeStore } from "../worktree-manager.js";
import { WorkspaceService } from "../workspace-service.js";
import { createControlApi } from "./handlers.js";
import { startControlServer } from "./server.js";

const execFile = promisify(execFileCallback);
const tempRoots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  closeSessionDb();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local control server", () => {
  it("serves project and workspace commands on an owner-only socket", async () => {
    const fixture = await createFixture();
    const app = await createRepo(fixture.root, "app", { "README.md": "app\n" });
    const docs = await createRepo(fixture.root, "docs", { "docs.txt": "docs\n" });
    const server = await startControlServer({
      socketPath: fixture.socketPath,
      api: fixture.api,
    });
    servers.push(server);

    const info = await stat(fixture.socketPath);
    expect(info.isSocket()).toBe(true);
    expect(info.mode & 0o777).toBe(0o600);
    expect(server.address).toBe(fixture.socketPath);

    const project = await callControl({
      socketPath: fixture.socketPath,
      method: "project.create",
      params: { name: "Hilo", sources: [app, docs] },
      client: "cursor killer",
    }) as { id: string; source_folders: string[] };
    expect(project.source_folders).toEqual([app, docs]);

    const listed = await callControl({
      socketPath: fixture.socketPath,
      method: "project.list",
      params: {},
    }) as Array<{ id: string }>;
    expect(listed.map((row) => row.id)).toContain(project.id);

    const workspace = await callControl({
      socketPath: fixture.socketPath,
      method: "workspace.create",
      params: { project_id: project.id, branch: "feature/coord", base: "main" },
    }) as { id: string; branch: string; worktrees: Array<{ path: string }> };
    expect(workspace.branch).toBe("feature/coord");
    expect(workspace.worktrees).toHaveLength(2);

    const shown = await callControl({
      socketPath: fixture.socketPath,
      method: "workspace.show",
      params: { id: workspace.id },
    }) as { repos: Array<{ path: string; branch: string; head: string; dirty: boolean }> };
    expect(shown.repos).toHaveLength(2);
    expect(shown.repos.every((repo) => repo.branch === "feature/coord" && repo.head && !repo.dirty)).toBe(true);

    await writeFile(join(shown.repos[0]!.path, "dirty.txt"), "wip\n");
    await expect(callControl({
      socketPath: fixture.socketPath,
      method: "workspace.remove",
      params: { id: workspace.id, force: false },
    })).rejects.toThrow(/uncommitted changes/);

    await callControl({
      socketPath: fixture.socketPath,
      method: "workspace.remove",
      params: { id: workspace.id, force: true },
    });
    await expect(callControl({
      socketPath: fixture.socketPath,
      method: "workspace.show",
      params: { id: workspace.id },
    })).rejects.toMatchObject({ code: "not_found" });

    const out: string[] = [];
    const code = await runCli(["project", "show", project.id, "--json"], {
      BACKCHAT_CONTROL_SOCK: fixture.socketPath,
    }, {
      stdout: (line: string) => out.push(line),
      stderr: () => undefined,
    });
    expect(code).toBe(ExitCode.ok);
    expect(JSON.parse(out[0]!).id).toBe(project.id);

    await chmod(fixture.socketPath, 0o666);
    await expect(callControl({
      socketPath: fixture.socketPath,
      method: "project.list",
      params: {},
    })).rejects.toThrow(/owner-only/);
  });

  it("reuses an existing branch instead of creating a second one", async () => {
    const fixture = await createFixture();
    const app = await createRepo(fixture.root, "app", { "app.txt": "v1\n" });
    await git(app, "checkout", "-b", "feature/existing");
    await writeFile(join(app, "app.txt"), "v2\n");
    await git(app, "add", ".");
    await git(app, "commit", "-m", "feature");
    await git(app, "checkout", "main");
    const server = await startControlServer({ socketPath: fixture.socketPath, api: fixture.api });
    servers.push(server);
    const project = await callControl({
      socketPath: fixture.socketPath,
      method: "project.create",
      params: { name: "App", sources: [app] },
    }) as { id: string };
    const workspace = await callControl({
      socketPath: fixture.socketPath,
      method: "workspace.create",
      params: { project_id: project.id, branch: "feature/existing", base: "main" },
    }) as { worktrees: Array<{ path: string }> };
    expect(await readFile(join(workspace.worktrees[0]!.path, "app.txt"), "utf8")).toBe("v2\n");
    expect(await git(app, "branch", "--list", "feature/existing")).toContain("feature/existing");
  });
});

async function createFixture(): Promise<{
  root: string;
  socketPath: string;
  api: ReturnType<typeof createControlApi>;
}> {
  const root = await mkdtemp(join(tmpdir(), "backchat-control-"));
  tempRoots.push(root);
  openSessionDb(join(root, "sessions.db"));
  const api = createControlApi({
    workspaces: new WorkspaceService(new ManagedWorktreeStore(join(root, "worktrees"))),
  });
  return { root, socketPath: join(root, "control.sock"), api };
}

async function createRepo(root: string, name: string, files: Record<string, string>): Promise<string> {
  const repo = join(root, "sources", name);
  await mkdir(repo, { recursive: true });
  await git(repo, "init", "--initial-branch=main");
  await git(repo, "config", "user.name", "Backchat Test");
  await git(repo, "config", "user.email", "backchat@example.test");
  for (const [path, contents] of Object.entries(files)) {
    const target = join(repo, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "fixture");
  return repo;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.stdout;
}
