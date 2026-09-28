import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { GitChange, GitComparison, GitEnvironment } from "../shared/workspaces.js";

const execFile = promisify(execFileCallback);
const git = (cwd: string, ...args: string[]) =>
  execFile("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).then((result) => result.stdout.trim());
const gitRaw = (cwd: string, ...args: string[]) =>
  execFile("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).then((result) => result.stdout);

const numstat = (value: string): Array<{ path: string; insertions: number; deletions: number }> =>
  value.split("\n").filter(Boolean).flatMap((line) => {
    const [inserted, deleted, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path || inserted === undefined || deleted === undefined) return [];
    return [{ path, insertions: Number(inserted) || 0, deletions: Number(deleted) || 0 }];
  });

export async function readGitEnvironment(cwd: string): Promise<GitEnvironment | null> {
  try {
    const [head, branch, remote, status, diff] = await Promise.all([
      git(cwd, "rev-parse", "HEAD"),
      git(cwd, "rev-parse", "--abbrev-ref", "HEAD").catch(() => "HEAD"),
      git(cwd, "remote", "get-url", "origin").catch(() => undefined),
      gitRaw(cwd, "status", "--porcelain=v1", "-z"),
      git(cwd, "diff", "HEAD", "--numstat").catch(() => ""),
    ]);
    const changes: GitChange[] = status
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const code = entry.slice(0, 2).trim() || "M";
        const path = entry.slice(3).split(" -> ").at(-1) ?? entry.slice(3);
        return { path, status: code };
      });
    const tracked = new Map(numstat(diff).map((item) => [item.path, item]));
    for (const change of changes) {
      if (!tracked.has(change.path) && change.status === "??") tracked.set(change.path, { path: change.path, insertions: 1, deletions: 0 });
    }
    const files = [...tracked.values()];
    return {
      cwd,
      head,
      branch: branch === "HEAD" ? null : branch,
      ...(remote ? { remote } : {}),
      changes,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    };
  } catch {
    return null;
  }
}

export async function compareGitBranches(
  cwd: string,
  baseBranch: string,
  headBranch: string,
): Promise<GitComparison> {
  const files = numstat(await git(cwd, "diff", `${baseBranch}...${headBranch}`, "--numstat"));
  return {
    baseBranch,
    headBranch,
    files,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
