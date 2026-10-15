import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLinkIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
} from "@/components/Icons";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useI18n } from "@/lib/i18n";
import { repositoryWebLink } from "@shared/repository-web";
import type { GitReview } from "@shared/workspaces";

const PROVIDER_LABEL = { github: "GitHub", gitlab: "GitLab" } as const;

export function homeRelative(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** Hover card for a project or worktree row: where it lives on disk and,
 *  for each checkout, a jump to its GitHub / GitLab repository, its branch
 *  and the PR / MR that branch has. The local part (remote, branch) is one
 *  cheap git read; the review lookup goes through gh / glab and may take
 *  seconds, so it fills in on its own. Nothing is read until the card opens. */
export function RepositoryHoverCard({
  title,
  paths,
  disabled = false,
  children,
}: {
  title: string;
  paths: string[];
  /** Keep the card shut while the row's own menu is open. */
  disabled?: boolean;
  /** The whole sidebar row, so the card sits clear of its trailing actions. */
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const open = hovered && !disabled;
  const roots = [...new Set(paths.filter(Boolean))];
  return (
    <HoverCard open={open} onOpenChange={setHovered} openDelay={500} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      {roots.length > 0 && (
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={10}
          className="repository-card w-72 p-1.5 text-caption"
          data-repository-card="true"
        >
          <p className="truncate px-1.5 pb-1 pt-0.5 text-ui font-medium text-fg">{title}</p>
          {open && <RepositoryCardBody paths={roots} />}
        </HoverCardContent>
      )}
    </HoverCard>
  );
}

export function RepositoryCardBody({ paths }: { paths: string[] }) {
  const { t } = useI18n();
  const upstream = useQuery({
    queryKey: ["git-upstream", ...paths],
    queryFn: () => Promise.all(paths.map((path) => window.backchat.uiFsGitUpstream({ path }))),
    staleTime: 60_000,
  });
  const reviews = useQuery({
    queryKey: ["git-reviews", ...paths],
    queryFn: () => window.backchat.taskEnvironment({ kind: "local", environmentId: null, paths }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return (
    <div className="space-y-1">
      {paths.map((path, index) => {
        const git = upstream.data?.[index];
        const found = reviews.data?.checkouts.find((checkout) => checkout.path === path)?.reviews;
        const link = repositoryWebLink(git?.remote, git?.branch, found?.[0]?.kind);
        return (
          <section
            key={path}
            data-repository-checkout={path}
            className={index > 0 ? "border-t border-border/50 pt-1" : undefined}
          >
            {/* Keep the tail (the checkout's own folder) when the path is
                too long: truncate from the start, home shown as ~. */}
            <p className="truncate px-1.5 py-0.5 text-left text-fg-faint [direction:rtl]" title={path}>
              <bdi dir="ltr">{homeRelative(path)}</bdi>
            </p>
            {link && (
              <CardLink href={link.url} icon={<ExternalLinkIcon />} trailing={PROVIDER_LABEL[link.provider]}>
                {link.name}
              </CardLink>
            )}
            {git?.branch && (
              link?.branchUrl
                ? <CardLink href={link.branchUrl} icon={<GitBranchIcon />}>{git.branch}</CardLink>
                : <CardRow icon={<GitBranchIcon />}>{git.branch}</CardRow>
            )}
            {git?.branch && link && (
              found?.length
                ? found.map((review) => <ReviewLink key={review.url} review={review} />)
                : (
                  <p className="px-1.5 py-0.5 pl-[28px] text-fg-faint" data-repository-review-status={found ? "none" : "pending"}>
                    {found
                      ? t("repoCard.noReview", { kind: link.provider === "gitlab" ? "MR" : "PR" })
                      : t("repoCard.findingReview", { kind: link.provider === "gitlab" ? "MR" : "PR" })}
                  </p>
                )
            )}
            {upstream.data && !git?.remote && !git?.branch && (
              <p className="px-1.5 py-0.5 text-fg-faint">{t("repoCard.notGit")}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ReviewLink({ review }: { review: GitReview }) {
  const { t } = useI18n();
  const Icon = review.state === "merged" ? GitMergeIcon : review.state === "closed" ? GitPullRequestClosedIcon : GitPullRequestIcon;
  const state = t(`resourceRail.reviewState.${review.state === "open" && review.draft ? "draft" : review.state}`);
  return (
    <CardLink href={review.url} icon={<Icon />} trailing={state} data-repository-review={review.state}>
      {review.kind === "MR" ? "!" : "#"}{review.number} {review.title}
    </CardLink>
  );
}

function CardLink({ href, icon, trailing, children, ...rest }: {
  href: string;
  icon: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  "data-repository-review"?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className="repository-card-row flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-fg-subtle transition-colors hover:bg-[var(--control-bg-hover)] hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      {...rest}
    >
      <span className="repository-card-icon">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span className="shrink-0 text-fg-faint">{trailing}</span>}
    </a>
  );
}

function CardRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-fg-subtle">
      <span className="repository-card-icon">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}
