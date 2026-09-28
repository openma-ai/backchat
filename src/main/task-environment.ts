import type { CheckoutRevision, EnvironmentCheckout, TaskEnvironment } from "../shared/task-environment.js";
import { readGitEnvironment } from "./git-environment.js";
import { readGitReviews } from "./git-reviews.js";

function repositoryUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol)) return null;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch {
    // SCP-style Git remote; discard the login name, retain host/repository.
    return /^(?:[^@/:]+@)?[^/:]+:[^\s]+$/.test(value) ? value.replace(/^[^@]+@/, "") : null;
  }
}
function unknownCheckout(path: string): EnvironmentCheckout {
  return { path, repositoryUrl: null, configuredRevision: null, state: "unavailable", branch: null, headSha: null, changes: null, reviews: null, observedAt: null };
}
export function configuredEnvironment(environmentId: string, resources: unknown[]): TaskEnvironment {
  const checkouts: EnvironmentCheckout[] = [];
  for (const value of resources) {
    if (!value || typeof value !== "object") continue;
    const resource = value as Record<string, unknown>;
    if (resource.type !== "github_repository" || typeof resource.mount_path !== "string") continue;
    const raw = resource.checkout as Record<string, unknown> | null | undefined;
    const configuredRevision: CheckoutRevision | null = raw?.type === "branch" && typeof raw.name === "string" ? { type: "branch", name: raw.name }
      : raw?.type === "commit" && typeof raw.sha === "string" ? { type: "commit", sha: raw.sha } : null;
    checkouts.push({ ...unknownCheckout(resource.mount_path), repositoryUrl: repositoryUrl(resource.url), configuredRevision, state: "configured" });
  }
  return { environmentId, checkouts };
}
export async function readLocalEnvironment(environmentId: string | null, paths: string[]): Promise<TaskEnvironment> {
  const checkouts = await Promise.all([...new Set(paths.filter(Boolean))].map(async path => {
    const git = await readGitEnvironment(path);
    if (!git) return unknownCheckout(path);
    return { ...unknownCheckout(path), state: "live" as const, repositoryUrl: repositoryUrl(git.remote), branch: git.branch, headSha: git.head,
      changes: { files: git.changes, insertions: git.insertions, deletions: git.deletions },
      reviews: await readGitReviews(path).catch(() => null), observedAt: Date.now() };
  }));
  return { environmentId, checkouts };
}
