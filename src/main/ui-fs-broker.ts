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
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { InvokeChannel } from "../shared/ipc-channels.js";
import type { PromptAttachment } from "../shared/session-events.js";
import { resolveLocalFilePreview } from "./file-preview.js";
import { openmaRoot } from "./storage-root.js";

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

const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
let testPickedFiles: PromptAttachment[] | null = null;

function cloneAttachment(a: PromptAttachment): PromptAttachment {
  return { ...a };
}

function guessMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    case ".pdf":
      return "application/pdf";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".css":
      return "text/css";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".py":
      return "text/x-python";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

async function toPromptAttachment(filePath: string): Promise<PromptAttachment | null> {
  const s = await stat(filePath).catch(() => null);
  if (!s?.isFile()) return null;
  const mimeType = guessMimeType(filePath);
  const isImage = mimeType.startsWith("image/");
  const attachment: PromptAttachment = {
    id: randomUUID(),
    name: basename(filePath),
    path: filePath,
    uri: pathToFileURL(filePath).href,
    kind: isImage ? "image" : "file",
    mimeType,
    size: s.size,
  };
  if (isImage && s.size <= MAX_INLINE_IMAGE_BYTES) {
    attachment.data = (await readFile(filePath)).toString("base64");
  }
  return attachment;
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
  InvokeChannel.UiFsPickFiles,
  async (e, p: { defaultPath?: string } = {}): Promise<PromptAttachment[]> => {
    if (process.env["BACKCHAT_TEST_HOOKS"] === "1" && testPickedFiles) {
      const files = testPickedFiles.map(cloneAttachment);
      testPickedFiles = null;
      return files;
    }

    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openFile", "multiSelections"],
      defaultPath: p.defaultPath || trueHome(),
      buttonLabel: "Attach",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"] },
        { name: "Documents", extensions: ["md", "txt", "pdf", "json", "csv", "html", "css", "js", "ts", "tsx", "py"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const rows = await Promise.all(result.filePaths.slice(0, 10).map(toPromptAttachment));
    return rows.filter((row): row is PromptAttachment => row !== null);
  },
);

ipcMain.handle(
  InvokeChannel.UiFsSaveCapture,
  async (
    _e,
    p: { data: string; name?: string; mimeType?: "image/png" },
  ): Promise<PromptAttachment> => {
    if (!p || typeof p.data !== "string" || p.data.length === 0) {
      throw new Error("Capture data is empty");
    }
    if (p.mimeType && p.mimeType !== "image/png") {
      throw new Error("Only PNG captures are supported");
    }
    const bytes = Buffer.from(p.data, "base64");
    if (bytes.length === 0 || bytes.length > MAX_CAPTURE_BYTES) {
      throw new Error("Capture exceeds the 16 MB limit");
    }
    const pngSignature = bytes.subarray(0, 8).toString("hex");
    if (pngSignature !== "89504e470d0a1a0a") {
      throw new Error("Capture is not a valid PNG image");
    }

    const requestedName = basename(p.name || `page-element-${Date.now()}.png`);
    const safeName = requestedName
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page-element.png";
    const finalName = safeName.toLowerCase().endsWith(".png")
      ? safeName
      : `${safeName}.png`;
    const captureDir = join(openmaRoot(), "captures");
    const capturePath = join(
      captureDir,
      `${Date.now()}-${randomUUID().slice(0, 8)}-${finalName}`,
    );
    await mkdir(captureDir, { recursive: true });
    await writeFile(capturePath, bytes, { flag: "wx" });
    const attachment = await toPromptAttachment(capturePath);
    if (!attachment) throw new Error("Saved capture could not be attached");
    return attachment;
  },
);

if (process.env["BACKCHAT_TEST_HOOKS"] === "1") {
  ipcMain.handle(
    InvokeChannel.TestSetPickedFiles,
    (_e, files: PromptAttachment[]): void => {
      testPickedFiles = files.map(cloneAttachment);
    },
  );
}

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
  InvokeChannel.UiFsRevealPath,
  (_e, p: { path: string }): void => {
    shell.showItemInFolder(p.path);
  },
);

ipcMain.handle(
  InvokeChannel.UiFsResolvePreview,
  (_e, p: { path: string }) => resolveLocalFilePreview(p.path),
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
