import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSessionCwd, setSessionRoot } from "./session-cwd.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("anonymous task workspace", () => {
  it("keeps local chat available without Git and initializes the same workspace once Git is installed", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-anonymous-")); roots.push(root); setSessionRoot(root);
    vi.stubEnv("PATH", root);
    const cwd = await ensureSessionCwd("no-git");
    await writeFile(join(cwd, "notes.txt"), "existing work");
    await expect(access(join(cwd, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    vi.unstubAllEnvs();
    expect(await ensureSessionCwd("no-git")).toBe(cwd);
    expect(await readFile(join(cwd, "notes.txt"), "utf8")).toBe("existing work");
    expect((await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).stdout.trim()).toBe(await realpath(cwd));
  });

  it("creates an independent empty Git repository without asking for a project name", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-anonymous-")); roots.push(root); setSessionRoot(root);
    const [cwd, again] = await Promise.all([ensureSessionCwd("task-a"), ensureSessionCwd("task-a")]);
    expect(cwd).toBe(join(root, "task-a")); expect(again).toBe(cwd);
    expect((await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).stdout.trim()).toBe(await realpath(cwd));
    expect((await exec("git", ["-C", cwd, "symbolic-ref", "--short", "HEAD"])).stdout.trim()).toBe("main");
    await writeFile(join(cwd, "work.txt"), "keep this work");
    await ensureSessionCwd("task-a");
    expect(await readFile(join(cwd, "work.txt"), "utf8")).toBe("keep this work");
    expect(await ensureSessionCwd("task-b")).not.toBe(cwd);
  });

  it("never uses a caller's path as the anonymous workspace name", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-anonymous-")); roots.push(root); setSessionRoot(root);
    for (const id of ["../escape", "/tmp/escape", ".", "", "a/b", "a\\b"]) {
      await expect(ensureSessionCwd(id)).rejects.toThrow(/session.*id/i);
    }
  });
});
