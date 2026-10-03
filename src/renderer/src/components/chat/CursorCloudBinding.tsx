import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SessionRow } from "@/lib/session-types";
import { sessionStore } from "@/lib/session-store";
import { useOpenmaAccount, useOpenmaCatalog } from "@/lib/openma-account";
import { useI18n } from "@/lib/i18n";
import { Input } from "@/components/ui/input";

export function CursorCloudBinding({ session }: { session: SessionRow | null | undefined }) {
  const { data: account } = useOpenmaAccount();
  const target = session?.executionTarget;
  const workspace = account?.workspaces.find((item) => item.id === (target?.workspaceId ?? session?.openma?.workspaceId));
  const provider = session?.openma?.provider ?? workspace?.provider;
  const draft = !!session && !!target && provider === "cursor-cloud" && session.status === "draft" && !session.openma;
  if (!draft || !session) return null;
  return <CursorCloudDraftFields session={session} />;
}

function CursorCloudDraftFields({ session }: { session: SessionRow }) {
  const { t } = useI18n();
  const target = session.executionTarget!;
  const sourcePath = target.cursor?.sourcePath || session.chosenCwd || session.cwd || "";
  const { data: catalog } = useOpenmaCatalog(target);
  const { data: git } = useQuery({
    queryKey: ["cursor-git-upstream", sourcePath],
    queryFn: () => window.backchat.uiFsGitUpstream({ path: sourcePath }),
    enabled: !!sourcePath && target.cursor?.repoUrl === undefined,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!git || target.cursor?.repoUrl !== undefined) return;
    const current = sessionStore.get(session.id)?.executionTarget;
    if (!current || current.cursor?.repoUrl !== undefined) return;
    sessionStore.setExecutionTarget(session.id, {
      ...current,
      cursor: {
        ...current.cursor,
        ...(sourcePath ? { sourcePath } : {}),
        ...(git.repositoryUrl ? { repoUrl: git.repositoryUrl } : {}),
        ...(!current.cursor?.startingRef && git.branch ? { startingRef: git.branch } : {}),
      },
    });
  }, [git, session.id, sourcePath, target.cursor?.repoUrl, target.cursor?.startingRef]);

  const write = (patch: { repoUrl?: string; startingRef?: string }) => {
    const current = sessionStore.get(session.id)?.executionTarget;
    if (!current) return;
    sessionStore.setExecutionTarget(session.id, {
      ...current,
      cursor: { ...current.cursor, ...(sourcePath ? { sourcePath } : {}), ...patch },
    });
  };

  return (
    <div className="composer-footer-row-inset mb-[var(--composer-footer-gap)] flex flex-wrap items-center gap-2 text-xs text-fg-muted" data-cursor-cloud-binding="true">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0">{t("cursor.repository")}</span>
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          list={`cursor-repos-${session.id}`}
          aria-label={t("cursor.repository")}
          placeholder={t("cursor.repositoryPlaceholder")}
          value={target.cursor?.repoUrl ?? ""}
          onChange={(event) => write({ repoUrl: event.target.value })}
        />
        <datalist id={`cursor-repos-${session.id}`}>
          {catalog?.repositories?.map((repo) => <option key={repo.url} value={repo.url} />)}
        </datalist>
      </label>
      <label className="flex items-center gap-2">
        <span className="shrink-0">{t("cursor.branch")}</span>
        <Input
          className="h-7 w-28 text-xs"
          aria-label={t("cursor.branch")}
          placeholder={t("cursor.branchPlaceholder")}
          value={target.cursor?.startingRef ?? ""}
          onChange={(event) => write({ startingRef: event.target.value })}
        />
      </label>
      <span className="basis-full text-[11px] text-fg-subtle">{target.cursor?.repoUrl ? t("cursor.bindingHint") : t("cursor.noRepository")}</span>
    </div>
  );
}
