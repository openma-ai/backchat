import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { configuredEnvironment, readLocalEnvironment } from "./task-environment.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
it("keeps remote checkout configuration separate from unknown live Git state", () => {
  expect(configuredEnvironment("env", [{ type: "github_repository", url: "https://github.com/team/repo.git", mount_path: "/workspace/repo", checkout: { type: "branch", name: "main" } }])).toEqual({
    environmentId: "env", checkouts: [{ path: "/workspace/repo", repositoryUrl: "https://github.com/team/repo.git", configuredRevision: { type: "branch", name: "main" },
      state: "configured", branch: null, headSha: null, changes: null, reviews: null, observedAt: null }],
  });
});
it("does not copy credentials or unrelated resource fields into public environment data", () => {
  const result = configuredEnvironment("env", [{ type: "github_repository", url: "https://secret@github.com/team/repo", authorization_token: "secret", mount_path: "/repo", checkout: { type: "commit", sha: "abc" } }, { type: "file", mount_path: "/file" }]);
  expect(result.checkouts).toHaveLength(1);
  expect(result.checkouts[0]).toMatchObject({ repositoryUrl: "https://github.com/team/repo", configuredRevision: { type: "commit", sha: "abc" }, headSha: null });
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("reads each local checkout into the same envelope and represents missing data as unknown", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "backchat-environment-")); roots.push(cwd);
  const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
  git("init", "-b", "feature"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid"); git("config", "core.hooksPath", "/dev/null"); git("commit", "--allow-empty", "-m", "initial");
  const result = await readLocalEnvironment("env", [cwd, cwd, join(cwd, "missing")]);
  expect(result.environmentId).toBe("env");
  expect(result.checkouts).toHaveLength(2);
  expect(result.checkouts[0]).toMatchObject({ path: cwd, repositoryUrl: null, branch: "feature", state: "live", changes: { files: [], insertions: 0, deletions: 0 }, reviews: [] });
  expect(result.checkouts[0]!.headSha).toMatch(/^[a-f0-9]{40}$/);
  expect(result.checkouts[1]).toMatchObject({ state: "unavailable", branch: null, changes: null, reviews: null });
});
