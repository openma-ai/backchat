/**
 * UI fs broker — readonly directory listing for the side-panel file
 * tree. Distinct from `brokers.ts` fs methods which serve ACP children
 * (those need write + approval modals). This broker is renderer-driven,
 * narrow, and safe-by-default: read only, no write, no recursion.
 *
 * Symlinks are followed (so users browsing a workspace symlinked under
 * `~/projects/foo` see the real target's entries). Hidden files
 * (.dotfiles) are returned — the renderer decides whether to show or
 * hide them.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { readdir, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { InvokeChannel } from "../shared/ipc-channels.js";

interface DirEntry {
  name: string;
  isDir: boolean;
  /** Set when stat() fails — used to render the row as muted. Common
   *  causes: broken symlink, permission denied, deleted between
   *  readdir and stat. */
  error?: string;
}

/** Resolve $HOME via the OS passwd database, NOT $HOME env var.
 *  os.homedir() prefers $HOME, which on some setups (multi-user
 *  machines with shared shells, su sessions, custom .zshrc) points
 *  at the WRONG user's directory. os.userInfo().homedir reads the
 *  passwd entry for the process's effective uid, which is the canonical
 *  answer. Image #23 surfaced this — $HOME was set to /Users/minimax
 *  while the user was logged in as minimax, so file tree + agent cwd
 *  both landed in a stranger's home. */
function trueHome(): string {
  return userInfo().homedir;
}

ipcMain.handle(InvokeChannel.UiFsHome, (): string => trueHome());

ipcMain.handle(
  InvokeChannel.UiFsPickDir,
  async (e, p: { defaultPath?: string } = {}): Promise<string | null> => {
    // Anchor the dialog to the window that invoked it — without this
    // the picker can show as a floating modal that doesn't block our
    // app, which feels detached on macOS.
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: p.defaultPath || trueHome(),
      buttonLabel: "Select",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  },
);

ipcMain.handle(
  InvokeChannel.UiFsListDir,
  async (_e, p: { path: string }): Promise<DirEntry[]> => {
    try {
      const names = await readdir(p.path);
      // Stat each entry in parallel — readdir doesn't tell us isDir on
      // its own (the withFileTypes flag does but stat() is more robust
      // against symlinks because it follows them).
      const out = await Promise.all(
        names.map(async (name): Promise<DirEntry> => {
          try {
            const s = await stat(join(p.path, name));
            return { name, isDir: s.isDirectory() };
          } catch (e) {
            return { name, isDir: false, error: (e as Error).message };
          }
        }),
      );
      // Folders first, then alphabetical (case-insensitive). Hidden
      // files (.foo) intermixed.
      out.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      return out;
    } catch (e) {
      // Whole directory unreachable — surface as an empty list with a
      // single synthetic entry so the renderer can show the error.
      return [{ name: `<${(e as Error).message}>`, isDir: false, error: String(e) }];
    }
  },
);

interface RecentEntry {
  name: string;
  /** Absolute path so renderer can pass it to UiFsOpenPath without
   *  re-joining. */
  path: string;
  isDir: boolean;
  /** Epoch ms — for sort order display only. */
  mtime: number;
}

ipcMain.handle(
  InvokeChannel.UiFsRecent,
  async (_e, p: { path: string; limit?: number }): Promise<RecentEntry[]> => {
    const limit = p.limit ?? 8;
    try {
      const names = await readdir(p.path);
      const rows = await Promise.all(
        names
          // Filter out dotfiles + common noise — recent feed should
          // surface the user's work artifacts, not editor / OS files.
          .filter((n) => !n.startsWith(".") && n !== "node_modules")
          .map(async (name): Promise<RecentEntry | null> => {
            try {
              const full = join(p.path, name);
              const s = await stat(full);
              return {
                name,
                path: full,
                isDir: s.isDirectory(),
                mtime: s.mtimeMs,
              };
            } catch {
              return null;
            }
          }),
      );
      return rows
        .filter((r): r is RecentEntry => r !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);
    } catch {
      return [];
    }
  },
);

ipcMain.handle(
  InvokeChannel.UiFsOpenPath,
  async (_e, p: { path: string }): Promise<string> => {
    // shell.openPath returns "" on success, error message on failure.
    return shell.openPath(p.path);
  },
);

ipcMain.handle(
  InvokeChannel.UiFsGitBranch,
  async (_e, p: { path: string }): Promise<string | null> => {
    // Cheapest possible "what branch is this repo on" — read .git/HEAD.
    // For a regular checkout HEAD looks like `ref: refs/heads/<branch>\n`.
    // For a detached HEAD it's a bare SHA; we return null in that case so
    // the chip hides rather than printing 40 hex chars.
    // For a git worktree, .git is a file `gitdir: <real-git-dir>` — we
    // follow that one level. We don't shell out to `git`, which keeps
    // the latency under a millisecond and avoids spawning a process
    // every time the user picks a workspace.
    try {
      const { readFile, stat } = await import("node:fs/promises");
      const { join, isAbsolute, dirname } = await import("node:path");
      let dotGit = join(p.path, ".git");
      const s = await stat(dotGit).catch(() => null);
      if (!s) return null;
      if (s.isFile()) {
        // git worktree: .git file points at the real gitdir
        const text = await readFile(dotGit, "utf-8");
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
        if (!m) return null;
        const target = m[1]!;
        dotGit = isAbsolute(target) ? target : join(dirname(dotGit), target);
      }
      const head = await readFile(join(dotGit, "HEAD"), "utf-8");
      const m = /^ref:\s+refs\/heads\/(.+?)\s*$/.exec(head);
      return m ? (m[1] ?? null) : null;
    } catch {
      return null;
    }
  },
);
