import { execFile as execFileCallback } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
export type ImageCommand = (command: string, args: string[], cwd: string) => Promise<string>;
const command: ImageCommand = async (name, args, cwd) => {
  const { stdout } = await execFile(name, args, { cwd, encoding: "utf8", timeout: 8_000, maxBuffer: 256_000,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
  return stdout.trim();
};

/** Prefer repository artwork, then the organization/user owner avatar. */
export function customRepositoryImage(value: unknown): string | null {
  const repo = value as { usesCustomOpenGraphImage?: boolean; openGraphImageUrl?: unknown; owner?: { avatarUrl?: unknown } } | null;
  const candidates = [repo?.usesCustomOpenGraphImage === true ? repo.openGraphImageUrl : null, repo?.owner?.avatarUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) continue;
    if (url.hostname.endsWith(".githubusercontent.com") ||
      (url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/"))) return url.href;
  } catch { /* Try the owner when the repository image is invalid. */ }
  }
  return null;
}

export async function readRepositoryImage(cwd: string, run: ImageCommand = command): Promise<string | null> {
  try { return await fetchRepositoryImage(cwd, run); } catch { return null; }
}

/** GitHub serves the owner (user or organization) avatar without auth, so a
 *  readable remote is enough to keep a project off the letter tile. */
function ownerAvatar(owner: string): string | null {
  return customRepositoryImage({ owner: { avatarUrl: `https://avatars.githubusercontent.com/${owner}?s=64` } });
}

/** Like readRepositoryImage, but a failed lookup (no git, gh timeout, TLS
 *  error) throws instead of reading as "this repository has no image", so a
 *  cache can keep its last good value. */
export async function fetchRepositoryImage(cwd: string, run: ImageCommand = command): Promise<string | null> {
  let remote: string;
  try {
    remote = await run("git", ["remote", "get-url", "origin"], cwd);
  } catch {
    return null; // not a git checkout or no origin: a definite "no image"
  }
  let url: URL;
  try {
    url = remote.includes("://") ? new URL(remote) : new URL(`ssh://${remote.replace(":", "/")}`);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;
  // Copied remotes often carry a trailing slash after `.git`; strip the
  // slashes first so the path stays owner/name and not a third empty part.
  const parts = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "").split("/");
  if (parts.length !== 2 || parts.some(part => !/^[\w.-]+$/.test(part) || part === "." || part === "..")) return null;
  const [owner = "", name = ""] = parts;
  try {
    const result = JSON.parse(await run("gh", ["api", "graphql", "--hostname", "github.com", "-f",
      "query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){usesCustomOpenGraphImage openGraphImageUrl owner{avatarUrl(size:64)}}}",
      "-f", `owner=${owner}`, "-f", `name=${name}`], cwd));
    const image = customRepositoryImage(result?.data?.repository);
    if (image) return image;
  } catch {
    // `gh` missing, timed out or offline: the owner avatar still identifies
    // the project, so the sidebar shows a mark instead of a letter tile.
  }
  return ownerAvatar(owner);
}

interface CachedRepositoryImage {
  image: string | null;
  fetched_at: number;
}

export interface RepositoryImageCache {
  /** Last known image for a folder. The first lookup waits for `gh`; after
   *  that the cached value is returned immediately and refreshed in the
   *  background once older than `refreshAfterMs`. */
  get(cwd: string): Promise<string | null>;
  /** Settles when no refresh is in flight (tests, shutdown). */
  idle(): Promise<void>;
  /** Persist pending changes now. */
  flush(): Promise<void>;
}

/** Main-owned last-known-good cache for repository artwork. A renderer reload
 *  or app restart renders avatars from disk without a `gh` call, and a failed
 *  refresh never replaces a good image with nothing. */
export function createRepositoryImageCache(options: {
  file: string;
  read?: (cwd: string) => Promise<string | null>;
  now?: () => number;
  refreshAfterMs?: number;
  /** Minimum gap before retrying after a failed refresh. */
  retryAfterFailureMs?: number;
}): RepositoryImageCache {
  const read = options.read ?? ((cwd: string) => fetchRepositoryImage(cwd));
  const now = options.now ?? Date.now;
  const refreshAfterMs = options.refreshAfterMs ?? 24 * 60 * 60_000;
  const retryAfterFailureMs = options.retryAfterFailureMs ?? 10 * 60_000;
  const inflight = new Map<string, Promise<string | null>>();
  /** In-memory only: last failed attempt, so a broken `gh` is not re-run on
   *  every render while the cached value keeps serving. */
  const failedAt = new Map<string, number>();
  let entries: Map<string, CachedRepositoryImage> | null = null;
  let dirty = false;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const load = (): Map<string, CachedRepositoryImage> => {
    if (entries) return entries;
    entries = new Map();
    try {
      const parsed = JSON.parse(readFileSync(options.file, "utf8")) as Record<string, CachedRepositoryImage>;
      for (const [cwd, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.fetched_at === "number"
          && (entry.image === null || customRepositoryImage({ owner: { avatarUrl: entry.image } }) === entry.image
            || customRepositoryImage({ usesCustomOpenGraphImage: true, openGraphImageUrl: entry.image }) === entry.image)) {
          entries.set(cwd, { image: entry.image, fetched_at: entry.fetched_at });
        }
      }
    } catch { /* first run or unreadable: start empty */ }
    return entries;
  };

  const flush = async (): Promise<void> => {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (!dirty || !entries) return;
    dirty = false;
    await mkdir(dirname(options.file), { recursive: true });
    const tmp = `${options.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries(entries)));
    await rename(tmp, options.file);
  };

  const scheduleWrite = () => {
    dirty = true;
    if (writeTimer) return;
    writeTimer = setTimeout(() => { writeTimer = null; void flush().catch(() => {}); }, 500);
    writeTimer.unref?.();
  };

  const refresh = (cwd: string): Promise<string | null> => {
    const running = inflight.get(cwd);
    if (running) return running;
    const task = read(cwd)
      .then((image) => {
        failedAt.delete(cwd);
        load().set(cwd, { image, fetched_at: now() });
        scheduleWrite();
        return image;
      }, () => {
        failedAt.set(cwd, now());
        return load().get(cwd)?.image ?? null; // keep last good value
      })
      .finally(() => inflight.delete(cwd));
    inflight.set(cwd, task);
    return task;
  };

  return {
    async get(cwd) {
      const cached = load().get(cwd);
      if (!cached) return refresh(cwd);
      const failed = failedAt.get(cwd);
      if (
        now() - cached.fetched_at >= refreshAfterMs
        && (failed === undefined || now() - failed >= retryAfterFailureMs)
      ) void refresh(cwd);
      return cached.image;
    },
    async idle() {
      await Promise.allSettled([...inflight.values()]);
    },
    flush,
  };
}
