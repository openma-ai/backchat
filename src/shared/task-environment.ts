import type { GitChange, GitReview } from "./workspaces.js";

/** Configured revision is not evidence of the currently checked-out revision. */
export type CheckoutRevision = { type: "branch"; name: string } | { type: "commit"; sha: string };
export interface EnvironmentCheckout {
  path: string;
  repositoryUrl: string | null;
  configuredRevision: CheckoutRevision | null;
  state: "live" | "configured" | "unavailable";
  branch: string | null;
  headSha: string | null;
  changes: { files: GitChange[]; insertions: number; deletions: number } | null;
  /** null means unobserved; [] means the query returned no reviews. */
  reviews: GitReview[] | null;
  observedAt: number | null;
}
export interface TaskEnvironment {
  environmentId: string | null;
  checkouts: EnvironmentCheckout[];
}
export type TaskEnvironmentRequest =
  | { kind: "local"; environmentId: string | null; paths: string[] }
  | { kind: "remote"; taskId: string };
