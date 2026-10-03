import { readGitEnvironment } from "./git-environment.js";
import type { CursorCloudBinding } from "../shared/openma.js";

/** Cursor accepts provider URLs (`https://github.com/org/repo`), not scp or credentialed remotes. */
export function cursorRepositoryUrl(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  const scp = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (scp) candidate = `https://${scp[1]}/${scp[2]}`;
  else if (trimmed.startsWith("ssh://") || trimmed.startsWith("git://")) {
    try {
      const parsed = new URL(trimmed);
      candidate = `https://${parsed.hostname}${parsed.pathname}`;
    } catch {
      return null;
    }
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname || parsed.pathname === "/") return null;
    const path = parsed.pathname.replace(/\.git$/i, "").replace(/\/$/, "");
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return null;
  }
}

/**
 * A project folder supplies the default repository and branch when the draft
 * has not chosen them. An empty `repoUrl` is an explicit no-repo agent.
 */
export async function resolveCursorCloudBinding(binding: CursorCloudBinding | undefined): Promise<CursorCloudBinding> {
  const next: CursorCloudBinding = { ...binding };
  if (next.repoUrl === "") {
    return { sourcePath: next.sourcePath, ...(next.startingRef ? { startingRef: next.startingRef } : {}) };
  }
  if (next.repoUrl?.trim()) {
    const url = cursorRepositoryUrl(next.repoUrl);
    if (!url) throw new Error("Enter a repository URL such as https://github.com/org/repo");
    next.repoUrl = url;
  } else if (next.sourcePath) {
    const git = await readGitEnvironment(next.sourcePath);
    const url = git?.remote ? cursorRepositoryUrl(git.remote) : null;
    if (url) next.repoUrl = url;
    if (!next.startingRef && git?.branch) next.startingRef = git.branch;
  }
  if (!next.startingRef && next.sourcePath && next.repoUrl) {
    const git = await readGitEnvironment(next.sourcePath);
    if (git?.branch) next.startingRef = git.branch;
  }
  return next;
}
