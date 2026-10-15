export type RepositoryProvider = "github" | "gitlab";

export interface RepositoryWebLink {
  provider: RepositoryProvider;
  /** owner/name, or group/…/name on GitLab. */
  name: string;
  url: string;
  branchUrl: string | null;
}

/** Turn a clone address (as reported by task-environment, login already
 *  stripped) into the repository's web page. Only GitHub and GitLab are
 *  linked: the host decides, else a review of a known kind found for the
 *  checkout (self-hosted GitLab / GitHub Enterprise). Anything else gets no
 *  link rather than a guessed one. */
export function repositoryWebLink(
  repositoryUrl: string | null | undefined,
  branch: string | null | undefined,
  reviewKind?: "PR" | "MR",
): RepositoryWebLink | null {
  if (!repositoryUrl) return null;
  let host: string;
  let path: string;
  try {
    if (repositoryUrl.includes("://")) {
      const url = new URL(repositoryUrl);
      if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol)) return null;
      host = url.hostname;
      path = url.pathname;
    } else {
      const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(repositoryUrl);
      if (!scp) return null;
      host = scp[1]!;
      path = scp[2]!;
    }
  } catch {
    return null;
  }
  const name = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  const segments = name.split("/");
  if (!host || segments.length < 2 || segments.some((part) => !/^[\w.-]+$/.test(part))) return null;
  const provider: RepositoryProvider | null =
    host === "github.com" || reviewKind === "PR" ? "github"
      : /(^|\.)gitlab\./.test(host) || host === "gitlab.com" || reviewKind === "MR" ? "gitlab"
        : null;
  if (!provider) return null;
  const url = `https://${host}/${name}`;
  const ref = branch ? branch.split("/").map(encodeURIComponent).join("/") : null;
  return {
    provider,
    name,
    url,
    branchUrl: ref ? `${url}${provider === "github" ? "/tree/" : "/-/tree/"}${ref}` : null,
  };
}
