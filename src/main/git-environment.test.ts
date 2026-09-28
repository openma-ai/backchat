import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { compareGitBranches, readGitEnvironment } from "./git-environment.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "backchat-git-environment-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("remote", "add", "origin", "https://github.com/demo/app.git");
  writeFileSync(join(root, "README.md"), "one\n");
  git("add", "README.md");
  git("commit", "-m", "initial");
  return root;
}

it("reads the current branch, remote, and working-tree changes without persisting them", async () => {
  const root = repository();
  writeFileSync(join(root, "README.md"), "one\ntwo\n");
  const environment = await readGitEnvironment(root);
  expect(environment).toMatchObject({ branch: "main", remote: "https://github.com/demo/app.git" });
  expect(environment?.changes).toEqual([expect.objectContaining({ path: "README.md", status: "M" })]);
  expect(environment?.insertions).toBe(1);
  expect(environment?.deletions).toBe(0);
});

it("compares two branches as a read-only diff summary", async () => {
  const root = repository();
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  git("checkout", "-b", "feature");
  writeFileSync(join(root, "feature.txt"), "feature\n");
  git("add", "feature.txt");
  git("commit", "-m", "feature");
  const comparison = await compareGitBranches(root, "main", "feature");
  expect(comparison).toMatchObject({ baseBranch: "main", headBranch: "feature" });
  expect(comparison.files).toEqual([expect.objectContaining({ path: "feature.txt", insertions: 1 })]);
});
