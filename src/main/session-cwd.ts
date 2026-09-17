/**
 * Session bookkeeping under the shared ~/.oma/ dotdir.
 *
 *   ~/.oma/
 *     sessions/
 *       <sessionId>/   ← spawn cwd for the ACP child unless caller overrides.
 *
 * Spawn cwds outlive the daemon — when a user resumes an old session, we
 * respawn the ACP child in the same dir so transcripts the agent persisted
 * (e.g. claude-acp under ~/.claude/projects/<cwd-hash>/) line up. Removing
 * the cwd is reserved for an explicit "delete session" gesture.
 *
 * The OMA CLI and Backchat share this root and the same per-session spawn
 * directories.
 */

import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

let _root: string | null = null;
const preparing = new Map<string, Promise<string>>();
const exec = promisify(execFile);

/** Set once at app startup; later calls return the same path. */
export function setSessionRoot(root: string): void {
  _root = root;
}

function root(): string {
  if (!_root) throw new Error("session-cwd: setSessionRoot() not called yet");
  return _root;
}

export async function ensureSessionCwd(sessionId: string): Promise<string> {
  const dir = sessionDirectory(sessionId);
  const existing = preparing.get(dir);
  if (existing) return existing;
  const prepare = (async () => {
    await mkdir(dir, { recursive: true });
    try { await access(join(dir, ".git")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Managed task directories are private workspaces, including when their
      // parent happens to be a Git checkout. Never inherit a caller's GIT_DIR.
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
      try { await exec("git", ["init", "--quiet", "--initial-branch=main", "--template=", dir], { env, timeout: 30_000 }); }
      catch (error) {
        // Git is optional for local chat. Retry initialization on a later
        // start after installation, keeping files already created in this cwd.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error("Could not initialize the task's Git repository. Check that the workspace is writable.");
        }
      }
    }
    return dir;
  })();
  preparing.set(dir, prepare);
  try { return await prepare; }
  finally { if (preparing.get(dir) === prepare) preparing.delete(dir); }
}

function sessionDirectory(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,199}$/.test(sessionId)) throw new Error("Invalid session id for a task workspace");
  return join(root(), sessionId);
}

export async function removeSessionCwd(sessionId: string): Promise<void> {
  const dir = sessionDirectory(sessionId);
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
