import { execFile as execFileCallback } from "node:child_process";
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
  try {
    const remote = await run("git", ["remote", "get-url", "origin"], cwd);
    const url = remote.includes("://") ? new URL(remote) : new URL(`ssh://${remote.replace(":", "/")}`);
    if (url.hostname !== "github.com") return null;
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length !== 2 || parts.some(part => !/^[\w.-]+$/.test(part))) return null;
    const result = JSON.parse(await run("gh", ["api", "graphql", "--hostname", "github.com", "-f",
      "query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){usesCustomOpenGraphImage openGraphImageUrl owner{avatarUrl(size:64)}}}",
      "-f", `owner=${parts[0]}`, "-f", `name=${parts[1]}`], cwd));
    return customRepositoryImage(result?.data?.repository);
  } catch { return null; }
}
