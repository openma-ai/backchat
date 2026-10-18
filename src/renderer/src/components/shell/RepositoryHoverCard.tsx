import { useQuery } from "@tanstack/react-query";
import { GitBranchIcon } from "@/components/Icons";
import { useI18n } from "@/lib/i18n";

export function homeRelative(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** One cheap local git read per checkout (remote + branch). Shared by the
 *  hover card and the row menu, and warmed while the pointer settles, so
 *  neither surface fills in after it has appeared. */
export function gitUpstreamQuery(paths: string[]) {
  return {
    queryKey: ["git-upstream", ...paths],
    queryFn: () => Promise.all(paths.map((path) => window.backchat.uiFsGitUpstream({ path }))),
    staleTime: 60_000,
  } as const;
}

/** What a project / worktree row is: each checkout's folder and branch.
 *  Read-only on purpose — repository, branch and PR / MR links live in the
 *  row's menu, so the card never waits on gh / glab and never reflows. */
export function RepositoryCardBody({ paths }: { paths: string[] }) {
  const { t } = useI18n();
  const upstream = useQuery(gitUpstreamQuery(paths));
  return (
    <div className="space-y-1">
      {paths.map((path, index) => {
        const git = upstream.data?.[index];
        return (
          <section
            key={path}
            data-repository-checkout={path}
            className={index > 0 ? "border-t border-border/50 pt-1" : undefined}
          >
            {/* Keep the tail (the checkout's own folder) when the path is
                too long: truncate from the start, home shown as ~. */}
            <p className="truncate px-1.5 py-0.5 text-left text-fg-faint [direction:rtl]">
              <bdi dir="ltr">{homeRelative(path)}</bdi>
            </p>
            {git?.branch ? (
              <p className="flex min-w-0 items-center gap-2 px-1.5 py-0.5 text-fg-subtle">
                <span className="repository-card-icon"><GitBranchIcon /></span>
                <span className="min-w-0 truncate">{git.branch}</span>
              </p>
            ) : upstream.data && !git?.remote ? (
              <p className="px-1.5 py-0.5 text-fg-faint" data-repository-not-git="true">{t("repoCard.notGit")}</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
