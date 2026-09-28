import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test, expect } from "./fixtures";
import { enableAgent, persistSessionFixture } from "./helpers";

test("discovers PR metadata through IPC, refreshes on reopen, and leaves thread state alone", async ({ app, page, home }) => {
  test.skip(process.platform === "win32", "POSIX CLI fixture");
  const cwd = join(home, "review-repo");
  const bin = join(home, "review-cli");
  mkdirSync(cwd);
  mkdirSync(bin);
  const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
  git("init", "-b", "feature/review");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  git("commit", "--allow-empty", "-m", "initial");
  git("remote", "add", "origin", "https://github.com/test/repo.git");
  writeFileSync(join(bin, "gh"), '#!/bin/sh\n/bin/cat "$(dirname "$0")/pr.json"\n', { mode: 0o755 });
  const response = (state: string) => writeFileSync(join(bin, "pr.json"), JSON.stringify({
    number: 42, url: "https://github.com/test/repo/pull/42", title: "Review fixture", state,
    statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }], reviewDecision: "CHANGES_REQUESTED",
  }));
  response("OPEN");
  await app.evaluate((_electron, { bin, delimiter }) => { process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`; }, { bin, delimiter });
  await enableAgent(page, "codex-acp");
  await persistSessionFixture(page, { sessionId: "git-review-task", title: "Git review task", agentId: "codex-acp", cwd, acpSessionId: "", events: [{ type: "user_prompt", data: { text: "Check the review" } }] });
  await page.reload();
  await page.getByRole("button", { name: "Expand project: review-repo", exact: true }).click();
  await page.getByRole("button", { name: "Git review task", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Task resources", exact: true });
  await toggle.click();
  const rail = page.getByRole("navigation", { name: "Task resources" });
  await expect(rail.getByRole("link", { name: /Review fixture/ })).toHaveAttribute("href", "https://github.com/test/repo/pull/42");
  await expect(rail.getByText("Open · CI failed · Changes requested", { exact: true })).toBeVisible();
  await expect(rail.locator('[data-backchat-icon="review-open"]')).toBeVisible();
  const status = await rail.getByRole("status").textContent();
  response("MERGED");
  await toggle.click();
  await expect(rail).toBeHidden();
  await toggle.click();
  await expect(rail.getByText("Merged · CI failed · Changes requested", { exact: true })).toBeVisible();
  await expect(rail.locator('[data-backchat-icon="review-merged"]')).toBeVisible();
  await expect(rail.getByRole("status")).toHaveText(status!);
  response("CLOSED");
  await toggle.click();
  await toggle.click();
  await expect(rail.locator('[data-backchat-icon="review-closed"]')).toBeVisible();
  await expect(rail.getByRole("status")).toHaveText(status!);
});
