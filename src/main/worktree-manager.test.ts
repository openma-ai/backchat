import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedWorktreeStore } from "./worktree-manager";

const execFile = promisify(execFileCallback);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
  tempRoots.length = 0;
});

describe("ManagedWorktreeStore", () => {
  it("creates a detached session checkout under the controlled root", async () => {
    const fixture = await createFixture();
    const repo = await createRepo(fixture, "app", {
      "README.md": "app\n",
    });
    const store = new ManagedWorktreeStore(fixture.worktreeRoot);

    const prepared = await store.prepare({
      sessionId: "sess-one",
      sourceDirectories: [repo],
    });

    expect(prepared.created).toBe(true);
    expect(prepared.cwd).toMatch(
      new RegExp(`^${escapeRegex(join(fixture.worktreeRoot, "sess-one"))}`),
    );
    expect(prepared.additionalDirectories).toEqual([]);
    expect(await readFile(join(prepared.cwd, "README.md"), "utf8")).toBe("app\n");
    expect((await git(prepared.cwd, "rev-parse", "--abbrev-ref", "HEAD")).trim())
      .toBe("HEAD");
  });

  it("maps multiple roots from one repository into one checkout", async () => {
    const fixture = await createFixture();
    const repo = await createRepo(fixture, "monorepo", {
      "apps/web/package.json": "{}\n",
      "packages/shared/package.json": "{}\n",
    });
    const store = new ManagedWorktreeStore(fixture.worktreeRoot);

    const prepared = await store.prepare({
      sessionId: "sess-monorepo",
      sourceDirectories: [
        join(repo, "apps", "web"),
        join(repo, "packages", "shared"),
      ],
    });

    expect(prepared.additionalDirectories).toEqual([
      join(prepared.worktrees[0]!.path, "packages", "shared"),
    ]);
    expect(prepared.cwd).toBe(join(prepared.worktrees[0]!.path, "apps", "web"));
    expect(prepared.worktrees).toHaveLength(1);
  });

  it("creates and reuses one checkout per repository for a multi-repo session", async () => {
    const fixture = await createFixture();
    const app = await createRepo(fixture, "app", { "app.txt": "app\n" });
    const docs = await createRepo(fixture, "docs", { "docs.txt": "docs\n" });
    const store = new ManagedWorktreeStore(fixture.worktreeRoot);

    const first = await store.prepare({
      sessionId: "sess-multi",
      sourceDirectories: [app, docs],
    });
    const second = await store.prepare({
      sessionId: "sess-multi",
      sourceDirectories: [app, docs],
    });

    expect(first.worktrees).toHaveLength(2);
    expect(first.cwd).toBe(first.worktrees[0]!.path);
    expect(first.additionalDirectories).toEqual([first.worktrees[1]!.path]);
    expect(second).toEqual({ ...first, created: false });
  });

  it("rolls back already-created worktrees when a later root is not a Git repository", async () => {
    const fixture = await createFixture();
    const repo = await createRepo(fixture, "app", { "app.txt": "app\n" });
    const notGit = join(fixture.root, "not-git");
    await mkdir(notGit);
    const store = new ManagedWorktreeStore(fixture.worktreeRoot);

    await expect(store.prepare({
      sessionId: "sess-rollback",
      sourceDirectories: [repo, notGit],
    })).rejects.toThrow(
      `Workspace root is not inside a Git repository: ${await realpath(notGit)}`,
    );

    await expect(readFile(join(fixture.worktreeRoot, "sess-rollback", "workspace.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    const worktreeList = await git(repo, "worktree", "list", "--porcelain");
    expect(worktreeList).not.toContain(join(fixture.worktreeRoot, "sess-rollback"));
  });

  it("removes only the session-owned worktrees on hard cleanup", async () => {
    const fixture = await createFixture();
    const repo = await createRepo(fixture, "app", { "app.txt": "app\n" });
    const store = new ManagedWorktreeStore(fixture.worktreeRoot);
    const prepared = await store.prepare({
      sessionId: "sess-delete",
      sourceDirectories: [repo],
    });

    await store.remove("sess-delete");

    await expect(readFile(join(prepared.cwd, "app.txt")))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(repo, "app.txt"), "utf8")).toBe("app\n");
    expect(await git(repo, "worktree", "list", "--porcelain"))
      .not.toContain(prepared.worktrees[0]!.path);
  });

  it("refuses to take over a session directory that has no ownership manifest", async () => {
    const fixture = await createFixture();
    const repo = await createRepo(fixture, "app", { "app.txt": "app\n" });
    const orphan = join(fixture.worktreeRoot, "sess-orphan");
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, "uncommitted.txt"), "keep me\n", "utf8");
    const store = new ManagedWorktreeStore(fixture.worktreeRoot);

    await expect(store.prepare({
      sessionId: "sess-orphan",
      sourceDirectories: [repo],
    })).rejects.toThrow(
      `Managed worktree directory exists without an ownership manifest: ${orphan}`,
    );
    expect(await readFile(join(orphan, "uncommitted.txt"), "utf8"))
      .toBe("keep me\n");
  });

  it("rejects a manifest whose effective root escapes its owned checkout", async () => {
    const fixture = await createFixture();
    const repo = await createRepo(fixture, "app", { "app.txt": "app\n" });
    const canonicalRepo = await realpath(repo);
    const sessionDir = join(fixture.worktreeRoot, "sess-tampered");
    const checkout = join(sessionDir, "01-app");
    await mkdir(checkout, { recursive: true });
    await writeFile(join(sessionDir, "workspace.json"), JSON.stringify({
      version: 1,
      sessionId: "sess-tampered",
      sourceDirectories: [canonicalRepo],
      roots: [{
        sourcePath: canonicalRepo,
        effectivePath: fixture.root,
        worktreeIndex: 0,
      }],
      worktrees: [{ repoRoot: canonicalRepo, path: checkout, head: "abc" }],
    }), "utf8");
    const store = new ManagedWorktreeStore(fixture.worktreeRoot);

    await expect(store.prepare({
      sessionId: "sess-tampered",
      sourceDirectories: [repo],
    })).rejects.toThrow(
      `Managed workspace root escaped its worktree: ${fixture.root}`,
    );
  });
});

async function createFixture(): Promise<{ root: string; worktreeRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "backchat-worktrees-"));
  tempRoots.push(root);
  return { root, worktreeRoot: join(root, "managed", "worktrees") };
}

async function createRepo(
  fixture: { root: string },
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const repo = join(fixture.root, "sources", name);
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
  const result = await execFile("git", ["-C", cwd, ...args], {
    encoding: "utf8",
  });
  return result.stdout;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
