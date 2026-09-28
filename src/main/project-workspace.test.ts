import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { ProjectWorkspaceManager } from "./project-workspace.js";
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", cwd, ...args], {
    encoding: "utf8",
  }).trim();
it("isolates threads on branches and retains dirty work through reopen and session replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "thread-workspace-"));
  const db = new DatabaseSync(join(root, "host.db"));
  const repo = join(root, "repo");
  await mkdir(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  await writeFile(join(repo, "file.txt"), "base");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  const base = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-b", "other");
  await writeFile(join(repo, "file.txt"), "other");
  git(repo, "commit", "-am", "other");
  const project = {
    id: "p",
    name: "P",
    primary_folder: repo,
    source_folders: [repo],
    created_at: 1,
    updated_at: 1,
  };
  try {
    const manager = new ProjectWorkspaceManager(db, join(root, "workspaces"));
    const a = await manager.prepare(project, "worker:a", "worker", "main");
    const b = await manager.prepare(project, "worker:b", "worker", "main");
    expect(a.cwd).not.toBe(repo);
    expect(b.cwd).not.toBe(a.cwd);
    expect(git(a.cwd, "rev-parse", "HEAD")).toBe(base);
    expect(git(a.cwd, "branch", "--show-current")).not.toBe(
      git(b.cwd, "branch", "--show-current"),
    );
    expect(a.memoryDirectory).toEqual(expect.any(String));
    expect(a.memoryDirectory).not.toBe(b.memoryDirectory);
    expect(a.memoryDirectory!.startsWith(a.cwd + sep)).toBe(false);
    expect(a.additionalDirectories).toContain(a.memoryDirectory);
    expect(await readdir(a.memoryDirectory!)).toEqual([]);
    await writeFile(
      join(a.memoryDirectory!, "handoff.txt"),
      "Waiting for review: task A\n",
    );
    expect(git(a.cwd, "status", "--porcelain")).toBe("");
    await writeFile(join(a.cwd, "file.txt"), "dirty work");
    const resumed = await new ProjectWorkspaceManager(
      db,
      join(root, "workspaces"),
    ).prepare(project, "worker:a", "worker", "other");
    expect(resumed.cwd).toBe(a.cwd);
    expect(resumed.memoryDirectory).toBe(a.memoryDirectory);
    expect(
      await readFile(join(resumed.memoryDirectory!, "handoff.txt"), "utf8"),
    ).toBe("Waiting for review: task A\n");
    expect(await readFile(join(resumed.cwd, "file.txt"), "utf8")).toBe(
      "dirty work",
    );
    expect(await readFile(join(b.cwd, "file.txt"), "utf8")).toBe("base");
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("other");
    const coordinator = await manager.prepare(
      project,
      "coordinator",
      "coordinator",
      "main",
    );
    expect(coordinator.cwd).not.toBe(repo);
    expect(coordinator.additionalDirectories).toEqual([
      coordinator.memoryDirectory,
    ]);
    expect(coordinator.memoryDirectory).not.toBe(a.memoryDirectory);
    expect(await readdir(coordinator.memoryDirectory!)).toEqual([]);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps thread notes isolated by project and preserves them during concurrent reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "thread-memory-"));
  const db = new DatabaseSync(":memory:");
  const project = {
    id: "p",
    name: "P",
    primary_folder: "",
    source_folders: [],
    created_at: 1,
    updated_at: 1,
  };
  try {
    const manager = new ProjectWorkspaceManager(db, root);
    const a = await manager.prepare(project, "coordinator", "coordinator");
    const other = await manager.prepare(
      { ...project, id: "another" },
      "coordinator",
      "coordinator",
    );
    expect(a.memoryDirectory).toEqual(expect.any(String));
    expect(a.memoryDirectory).not.toBe(other.memoryDirectory);
    expect(await readdir(a.memoryDirectory!)).toEqual([]);
    await mkdir(join(a.memoryDirectory!, "notes"));
    await writeFile(
      join(a.memoryDirectory!, "notes", "decisions.json"),
      '{"next":"wait for the user"}\n',
    );
    await writeFile(join(a.memoryDirectory!, "handoff.txt"), "Existing handoff\n");
    const reopened = await Promise.all([
      manager.prepare(project, "coordinator", "coordinator"),
      manager.prepare(project, "coordinator", "coordinator"),
    ]);
    expect(reopened.map((w) => w.memoryDirectory)).toEqual([
      a.memoryDirectory,
      a.memoryDirectory,
    ]);
    expect(
      await readFile(
        join(a.memoryDirectory!, "notes", "decisions.json"),
        "utf8",
      ),
    ).toBe('{"next":"wait for the user"}\n');
    expect(await readFile(join(a.memoryDirectory!, "handoff.txt"), "utf8")).toBe(
      "Existing handoff\n",
    );
    expect(await readdir(other.memoryDirectory!)).toEqual([]);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("snapshots ordinary folders and refuses to silently replace a missing workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "plain-workspace-"));
  const db = new DatabaseSync(":memory:");
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "note"), "original");
  try {
    const project = {
      id: "plain",
      name: "Plain",
      primary_folder: source,
      source_folders: [source],
      created_at: 1,
      updated_at: 1,
    };
    const manager = new ProjectWorkspaceManager(db, join(root, "managed"));
    const a = await manager.prepare(project, "a", "worker");
    await writeFile(join(a.cwd, "note"), "thread edit");
    expect(await readFile(join(source, "note"), "utf8")).toBe("original");
    expect(a.branch).toBeNull();
    await rm(a.cwd, { recursive: true });
    await expect(manager.prepare(project, "a", "worker")).rejects.toThrow(
      "workspace is missing",
    );
    await expect(
      manager.prepare(
        {
          ...project,
          id: "recursive",
          primary_folder: root,
          source_folders: [root],
        },
        "b",
        "worker",
      ),
    ).rejects.toThrow("contains managed workspace");
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
