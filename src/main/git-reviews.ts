import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { GitReview } from "../shared/workspaces.js";

export type ReviewCommand = (command: string, args: string[], cwd: string) => Promise<string>;
const execFile = promisify(execFileCallback);
const PR_FIELDS = "number,url,title,state,isDraft,statusCheckRollup,reviewDecision";
const runCommand: ReviewCommand = async (command, args, cwd) => {
  const { stdout } = await execFile(command, args, {
    cwd, encoding: "utf8", timeout: 8_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GLAB_NO_PROMPT: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  return stdout.trim();
};

function checkState(value: unknown): GitReview["checks"] {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (["failure", "failed", "error", "cancelled", "canceled", "timed_out", "action_required", "startup_failure"].includes(status)) return "failed";
  if (["pending", "queued", "running", "in_progress", "created", "waiting_for_resource", "preparing", "manual", "scheduled", "requested", "waiting"].includes(status)) return "pending";
  if (["success", "passed", "neutral", "skipped"].includes(status)) return "passed";
  return "unknown";
}

function checks(item: Record<string, unknown>, kind: "PR" | "MR"): GitReview["checks"] {
  if (kind === "MR") {
    const pipeline = item.head_pipeline ?? item.pipeline;
    return checkState(pipeline && typeof pipeline === "object" ? (pipeline as Record<string, unknown>).status : undefined);
  }
  if (!Array.isArray(item.statusCheckRollup) || !item.statusCheckRollup.length) return "unknown";
  const states = item.statusCheckRollup.map((check: Record<string, unknown> | null) => checkState(check?.conclusion || check?.state || check?.status));
  if (states.includes("failed")) return "failed";
  if (states.includes("pending")) return "pending";
  return states.every(state => state === "passed") ? "passed" : "unknown";
}

function review(value: unknown, kind: "PR" | "MR"): GitReview | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rawState = typeof item.state === "string" ? item.state.toLowerCase() : "";
  const state = rawState === "opened" ? "open" : rawState;
  if (state !== "open" && state !== "merged" && state !== "closed") return null;
  const number = kind === "PR" ? item.number : item.iid;
  const address = kind === "PR" ? item.url ?? item.html_url : item.web_url;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || typeof address !== "string") return null;
  try {
    const url = new URL(address);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const suffix = kind === "PR" ? `/pull/${number}` : `/-/merge_requests/${number}`;
    if (!url.pathname.endsWith(suffix)) return null;
    const decision = typeof item.reviewDecision === "string" ? item.reviewDecision.toLowerCase() : "";
    const reviewState = decision === "approved" || decision === "changes_requested" ? decision
      : decision === "review_required" || item.detailed_merge_status === "not_approved" ? "required" : "unknown";
    return { kind, number, url: `${url.origin}${url.pathname}`, title: typeof item.title === "string" ? item.title : "",
      state, draft: item.isDraft === true || item.draft === true || item.work_in_progress === true, checks: checks(item, kind), review: reviewState };
  } catch { return null; }
}

/** Read-only, best-effort discovery. CLI authentication stays with gh/glab, not Backchat. */
export async function readGitReviews(cwd: string, run: ReviewCommand = runCommand): Promise<GitReview[]> {
  const remote = await runCommand("git", ["remote", "get-url", "origin"], cwd).catch(() => "");
  if (!remote) return [];
  let host: string;
  try {
    host = remote.includes("://") ? new URL(remote).hostname : remote.match(/^(?:[^@/]+@)?([^:/]+):/)?.[1] ?? "";
  } catch { return []; }
  if (!host || host === "bitbucket.org") return [];
  const json = async (command: string, args: string[]): Promise<unknown> => {
    try { return JSON.parse(await run(command, args, cwd)) as unknown; } catch { return null; }
  };
  // Custom GitLab domains need no configuration: glab resolves its host from Git remotes.
  // If glab cannot resolve it, try gh as well for GitHub Enterprise installations.
  if (host !== "github.com") {
    const result = await json("glab", ["mr", "view", "--output", "json"]);
    const mr = review(result, "MR");
    if (mr) return [mr];
    if (result !== null) return [];
  }
  const pr = review(await json("gh", ["pr", "view", "--json", PR_FIELDS]), "PR");
  if (pr) return [pr];
  const head = await runCommand("git", ["rev-parse", "HEAD"], cwd).catch(() => "");
  if (!/^[a-f0-9]{40,64}$/i.test(head)) return [];
  const repo = await json("gh", ["repo", "view", "--json", "nameWithOwner,parent"]) as {
    nameWithOwner?: string; parent?: { nameWithOwner?: string };
  } | null;
  const names = [...new Set([repo?.parent?.nameWithOwner, repo?.nameWithOwner])];
  for (const name of names) {
    if (typeof name !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(name)) continue;
    const items = await json("gh", ["api", `repos/${name}/commits/${head}/pulls`]);
    if (!Array.isArray(items)) continue;
    const reviews = items.map(item => review(item, "PR")).filter((item): item is GitReview => item !== null && item.state === "open");
    if (reviews.length) return Promise.all(reviews.map(async item =>
      review(await json("gh", ["pr", "view", item.url, "--json", PR_FIELDS]), "PR") ?? item));
  }
  return [];
}
