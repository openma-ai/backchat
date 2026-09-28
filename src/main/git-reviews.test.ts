import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readGitReviews, type ReviewCommand } from "./git-reviews.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function checkout(remote: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "backchat-reviews-"));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
  git("init", "-b", "feature/review");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "file"), "initial");
  git("add", "file");
  git("commit", "-m", "initial");
  git("remote", "add", "origin", remote);
  return cwd;
}

// Only remote CLI responses are substituted; repository discovery uses real Git.
const responses = (entries: Record<string, unknown>): ReviewCommand => async (command, args) => {
  const key = [command, ...args].join(" ");
  if (!(key in entries)) throw new Error(`Unavailable command: ${key}`);
  return JSON.stringify(entries[key]);
};

it("discovers an open GitHub PR without any transcript link", async () => {
  const cwd = checkout("git@github.com:team/repo.git");
  expect(await readGitReviews(cwd, responses({
    "gh pr view --json number,url,title,state,isDraft,statusCheckRollup,reviewDecision": { number: 42, url: "https://github.com/team/repo/pull/42", title: "Fix", state: "OPEN", isDraft: true, statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }], reviewDecision: "CHANGES_REQUESTED" },
  }))).toEqual([{ kind: "PR", number: 42, url: "https://github.com/team/repo/pull/42", title: "Fix", state: "open", draft: true, checks: "failed", review: "changes_requested" }]);
});

it("discovers a private self-hosted GitLab MR through glab", async () => {
  const cwd = checkout("ssh://git@git.company.test:2222/team/sub/repo.git");
  expect(await readGitReviews(cwd, responses({
    "glab mr view --output json": { iid: 7, web_url: "https://git.company.test/team/sub/repo/-/merge_requests/7", title: "Repair", state: "opened", head_pipeline: { status: "running" } },
  }))).toEqual([{ kind: "MR", number: 7, url: "https://git.company.test/team/sub/repo/-/merge_requests/7", title: "Repair", state: "open", draft: false, checks: "pending", review: "unknown" }]);
});

it("finds an upstream PR by HEAD when a fork's branch lookup fails", async () => {
  const cwd = checkout("https://github.com/me/repo.git");
  const head = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  expect(await readGitReviews(cwd, responses({
    "gh repo view --json nameWithOwner,parent": { nameWithOwner: "me/repo", parent: { nameWithOwner: "team/repo" } },
    [`gh api repos/team/repo/commits/${head}/pulls`]: [
      { number: 1, html_url: "https://github.com/team/repo/pull/1", state: "closed" },
      { number: 42, html_url: "https://github.com/team/repo/pull/42", title: "Fix", state: "open" },
    ],
  }))).toEqual([{ kind: "PR", number: 42, url: "https://github.com/team/repo/pull/42", title: "Fix", state: "open", draft: false, checks: "unknown", review: "unknown" }]);
});

it("leaves reviews empty when CLI authentication or installation is missing", async () => {
  expect(await readGitReviews(checkout("https://github.com/team/repo.git"), responses({}))).toEqual([]);
});

it.each(["javascript:alert(1)", "https://token@git.company.test/team/repo/-/merge_requests/7"])("ignores unsafe URLs: %s", async (web_url) => {
  expect(await readGitReviews(checkout("git@git.company.test:team/repo.git"), responses({
    "glab mr view --output json": { iid: 7, title: "Fix", state: "opened", web_url },
  }))).toEqual([]);
});

it("shows merged state from the current branch without changing the checkout", async () => {
  const cwd = checkout("git@git.company.test:team/repo.git");
  expect(await readGitReviews(cwd, responses({
    "glab mr view --output json": { iid: 7, title: "Fix", state: "merged", web_url: "https://git.company.test/team/repo/-/merge_requests/7", head_pipeline: { status: "success" } },
  }))).toMatchObject([{ state: "merged", checks: "passed" }]);
  expect(execFileSync("git", ["-C", cwd, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("feature/review");
});

it("returns no reviews outside a Git checkout", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "backchat-no-repo-"));
  roots.push(cwd);
  expect(await readGitReviews(cwd, responses({}))).toEqual([]);
});
