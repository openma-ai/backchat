/**
 * Session bookkeeping under the desktop's userData dir.
 *
 *   userData/
 *     sessions/
 *       <sessionId>/   ← spawn cwd for the ACP child unless caller overrides.
 *
 * Spawn cwds outlive the daemon — when a user resumes an old session, we
 * respawn the ACP child in the same dir so transcripts the agent persisted
 * (e.g. claude-acp under ~/.claude/projects/<cwd-hash>/) line up. Removing
 * the cwd is reserved for an explicit "delete session" gesture.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

let _root: string | null = null;

/** Set once at app startup; later calls return the same path. */
export function setSessionRoot(root: string): void {
  _root = root;
}

function root(): string {
  if (!_root) throw new Error("session-cwd: setSessionRoot() not called yet");
  return _root;
}

export async function ensureSessionCwd(sessionId: string): Promise<string> {
  const dir = join(root(), sessionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeSessionCwd(sessionId: string): Promise<void> {
  const dir = join(root(), sessionId);
  await rm(dir, { recursive: true, force: true });
}

/** Drop one or more files into the session cwd. Used in later phases when
 *  we want to seed the cwd with AGENTS.md or a project marker. */
export async function writeBundle(
  cwd: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  for (const f of files) {
    const target = join(cwd, f.path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, f.content, "utf-8");
  }
}
