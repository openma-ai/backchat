import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { previewLocalFile } from "@/lib/file-preview";
import { useEffect, useMemo, useRef, useState } from "react";
import { ListTreeIcon, FileIcon, GitPullRequestIcon, GitMergeIcon, GitPullRequestClosedIcon, GlobeIcon, PlusIcon, SquareTerminalIcon, GitBranchIcon, GitCompareArrowsIcon } from "@/components/Icons";
import { toast } from "sonner";
import { sessionStore, selectActive, selectSideTabs, selectActiveSideTab, selectTurnsFor, selectArtifactsFor, useSessionStore } from "@/lib/session-store";
import { relatedReviews } from "@/lib/related-reviews";
import { useI18n } from "@/lib/i18n";
import { useSettings } from "@/lib/settings-store";
import { browserSettings } from "@shared/browser-settings";
import { useRightRailCollapse } from "./AppShell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EnvironmentCheckout, TaskEnvironmentRequest } from "@shared/task-environment";
import type { GitComparison } from "@shared/workspaces";

const storageKey = (id: string) => `backchat:related-reviews:${id}`;
function readLinks(id: string): string[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(storageKey(id)) ?? "[]"); return Array.isArray(data) ? data.filter((v): v is string => typeof v === "string") : []; } catch { return []; }
}
export function TaskResourceMenu({ open, onOpenChange, docked }: { open: boolean; onOpenChange: (open: boolean) => void; docked: boolean }) {
  const reduceMotion = useReducedMotion();
  const session = useSessionStore(selectActive);
  const { t } = useI18n();

  return session ? <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild><button type="button" aria-label={t("resourceRail.title")} title={t("resourceRail.title")} className="app-no-drag inline-flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-surface hover:text-fg transition-colors data-[state=open]:bg-bg-surface focus-visible:outline-2 focus-visible:outline-ring"><ListTreeIcon size={14} /></button></PopoverTrigger>
    {docked ? createPortal(
      <AnimatePresence>{open && <motion.aside
        initial={{ opacity: 0, x: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: reduceMotion ? 0 : 12 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        data-resource-docked aria-label={t("resourceRail.title")} className="app-no-drag fixed z-40 overflow-y-auto rounded-2xl border border-border/40 bg-bg p-3" style={{ top: "52px", right: "var(--stage-inset)", maxHeight: "calc(100vh - 64px)", width: "300px" }}>
        <ResourceRail key={session.id} sessionId={session.id} cwd={session.cwd} onOpen={() => onOpenChange(false)} />
      </motion.aside>}</AnimatePresence>, document.body,
    ) : <PopoverContent onOpenAutoFocus={event => event.preventDefault()} align="end" side="bottom" sideOffset={12} className="w-[300px] max-w-[calc(100vw-24px)] max-h-[75vh] overflow-y-auto rounded-2xl p-3">
      <ResourceRail key={session.id} sessionId={session.id} cwd={session.cwd} onOpen={() => onOpenChange(false)} />
    </PopoverContent>}

  </Popover> : null;
}
function ResourceRail({ sessionId, cwd, onOpen }: { sessionId: string; cwd: string; onOpen: () => void }) {
  const session = useSessionStore(selectActive);
  const { t } = useI18n();
  const { set: setCollapsed } = useRightRailCollapse();
  const tabs = useSessionStore(selectSideTabs);
  const activeTab = useSessionStore(selectActiveSideTab);
  const turns = useSessionStore(useMemo(() => selectTurnsFor(sessionId), [sessionId]));
  const artifacts = useSessionStore(useMemo(() => selectArtifactsFor(sessionId), [sessionId]));
  const sources = useMemo(() => [...new Map([
    ...turns.flatMap(turn => (turn.attachments ?? []).map(file => [file.path, { uri: file.path, label: file.name, kind: "file" }] as const)),
    ...(artifacts.sources ?? []).map(source => [source.uri, source] as const),
  ]).values()], [turns, artifacts.sources]);
  const processes = useQuery({ queryKey: ["acp-terminals", sessionId], queryFn: () => window.backchat.acpTerminalsList({ sessionId }), refetchInterval: 5000, enabled: !session?.openma }).data ?? [];
  const directories = useMemo(() => [...new Set([cwd, ...(session?.additionalDirectories ?? [])].filter(Boolean))], [cwd, session?.additionalDirectories]);
  const [comparison, setComparison] = useState<GitComparison | null>(null);
  const environmentRequest = useMemo<TaskEnvironmentRequest>(() => session?.openma
    ? { kind: "remote", taskId: session.openma.id }
    : { kind: "local", environmentId: session?.workspaceId ?? null, paths: directories }, [session?.openma?.id, session?.workspaceId, directories]);
  const environment = useQuery({
    queryKey: ["task-environment", environmentRequest],
    queryFn: () => window.backchat.taskEnvironment(environmentRequest),
    staleTime: 30_000, refetchOnMount: "always", refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const previousStatus = useRef(session?.status);
  const { refetch: refreshEnvironment } = environment;
  useEffect(() => {
    const wasWorking = previousStatus.current === "running" || previousStatus.current === "starting";
    previousStatus.current = session?.status;
    if (wasWorking && session?.status !== "running" && session?.status !== "starting") void refreshEnvironment();
  }, [session?.status, refreshEnvironment]);
  const activeProcesses = session?.openma ? [] : processes.filter(process => !process.exited);
  const sourceUris = new Set(sources.map(source => source.uri));
  const outputs = session?.openma ? [] : artifacts.files.filter(path => !sourceUris.has(path));
  const visibleSources = session?.openma ? sources.filter(source => source.kind === "web") : sources;
  const settings = useSettings();
  const browserEnabled = browserSettings(settings?.browser).enabled;
  const [manual, setManual] = useState(() => readLinks(sessionId));
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reviews = useMemo(() => relatedReviews([
    ...manual, ...tabs.filter(tab => tab.type === "browser").map(tab => tab.payload),
    ...turns.flatMap(turn => [turn.promptText, turn.assistantText ?? ""]),
  ]), [manual, tabs, turns]);
  const buttonClass = "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-ui text-fg hover:bg-bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-ring";
  const open = async (type: "file" | "browser" | "terminal") => {
    if (busy) return;
    setBusy(true);
    try {
      const existing = tabs.find(tab => tab.type === type);
      if (existing) sessionStore.setActiveSideTabForTask(sessionId, existing.id);
      else if (type === "terminal") {
        const directory = cwd || await window.backchat.uiFsHome();
        const { terminalId } = await window.backchat.uiTermSpawn({ cwd: directory, cols: 80, rows: 24 });
        const id = sessionStore.openSideTabForTask(sessionId, "terminal", terminalId);
        sessionStore.patchSideTabForTask(sessionId, id, { terminalCwd: directory, needsRestore: false });
      } else sessionStore.openSideTabForTask(sessionId, type, type === "browser" ? "about:blank" : cwd || await window.backchat.uiFsHome());
      // A slow terminal spawn must not switch another task's visible panel.
      if (sessionStore.activeId() === sessionId) { setCollapsed(false); onOpen(); }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const statusKey = session?.status === "running" ? "resourceRail.running"
    : session?.status === "starting" ? "resourceRail.starting"
    : session?.status === "errored" ? "resourceRail.failed" : "resourceRail.idle";
  return <nav aria-label={t("resourceRail.title")} data-task-resource-rail className="app-no-drag space-y-4 text-caption">
    <header className="flex items-center justify-between gap-2 px-2">
      <h2 className="text-ui font-medium text-fg">{t("resourceRail.overview")}</h2>
      <span role="status" className={statusKey === "resourceRail.failed" ? "text-danger" : "text-fg-muted"}>{t(statusKey)}</span>
    </header>
    {(!!directories.length || !!session?.openma || !!environment.data?.checkouts.length) && <section aria-label={t("resourceRail.workspace")} className="space-y-1">
      {session?.openma && <h3 className="px-2 text-fg-muted">{session.openma.target.environmentName}</h3>}
      {environment.isPending && <p className="px-2 text-fg-subtle">{t("resourceRail.environmentLoading")}</p>}
      {environment.isError && <p className="px-2 text-fg-subtle">{t("resourceRail.environmentUnavailable")}</p>}
      {environment.data?.checkouts.map((checkout, index) => <RepositoryEnvironment key={`${checkout.path}:${index}`} checkout={checkout} local={!session?.openma} onCompare={setComparison} />)}
      {environment.data?.checkouts.length === 0 && <p className="px-2 text-fg-subtle">{t("resourceRail.noCheckouts")}</p>}
    </section>}
    {!!activeProcesses.length && <section>
      <h3 className="px-2 pb-1 text-caption font-normal text-fg-muted">{t("rightPanel.background")}</h3>
      {activeProcesses.map(process => <button key={process.terminalId} className={buttonClass} title={process.cwd} onClick={() => { sessionStore.openSideTabForTask(sessionId, "process", process.terminalId, process.command); setCollapsed(false); onOpen(); }}><SquareTerminalIcon className="size-4 shrink-0" /><span className="truncate">{process.command || process.terminalId}</span></button>)}
    </section>}
    {!!reviews.length && <section>
      <h3 className="px-2 pb-1 text-caption font-normal text-fg-muted">{t("resourceRail.reviews")}</h3>
      {reviews.map(review => <a key={review.url} href={review.url} target="_blank" rel="noreferrer" className={buttonClass} title={review.url}>
        <GitPullRequestIcon className="size-4 shrink-0" />
        <span className="truncate">{review.repository.split("/").pop()} · {review.kind === "MR" ? "!" : "#"}{review.number}</span>
      </a>)}
    </section>}
    {!!outputs.length && <section>
      <h3 className="px-2 pb-1 text-caption font-normal text-fg-muted">{t("rightPanel.outputs")}</h3>
      {outputs.map(path => <button key={path} className={buttonClass} title={path} onClick={() => { void previewLocalFile(path); onOpen(); }}><FileIcon className="size-4 shrink-0" /><span className="truncate">{path.split("/").pop()}</span></button>)}
    </section>}
    {!!visibleSources.length && <section>
      <h3 className="px-2 pb-1 text-caption font-normal text-fg-muted">{t("rightPanel.sources")}</h3>
      {visibleSources.map(source => source.kind === "web" ? <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer" className={buttonClass}><GlobeIcon className="size-4 shrink-0" /><span className="truncate">{source.label || source.uri}</span></a> : <button key={source.uri} className={buttonClass} title={source.uri} onClick={() => { void previewLocalFile(source.uri); onOpen(); }}><FileIcon className="size-4 shrink-0" /><span className="truncate">{source.label || source.uri.split("/").pop()}</span></button>)}
    </section>}
    {tabs.length > 0 && <section>
      <h3 className="px-2 pb-1 text-caption font-normal text-fg-muted">{t("resourceRail.openTabs")}</h3>
      {tabs.map(tab => <button key={tab.id} className={buttonClass} title={tab.label || tab.payload} aria-current={activeTab?.id === tab.id ? "page" : undefined} onClick={() => { sessionStore.setActiveSideTabForTask(sessionId, tab.id); setCollapsed(false); onOpen(); }}>
        {tab.type === "browser" ? <GlobeIcon className="size-4 shrink-0" /> : tab.type === "terminal" ? <SquareTerminalIcon className="size-4 shrink-0" /> : <FileIcon className="size-4 shrink-0" />}
        <span className="truncate">{tab.label || tab.payload}</span>
      </button>)}
    </section>}
    <footer className="border-t border-border/40 pt-2">
      {!session?.openma && <div aria-label={t("resourceRail.tools")} className="flex gap-1">
        {([{ type: "file", Icon: FileIcon, label: t("sideChat.file") }, ...(browserEnabled ? [{ type: "browser", Icon: GlobeIcon, label: t("sideChat.browser") }] : []), { type: "terminal", Icon: SquareTerminalIcon, label: t("sideChat.terminal") }] as const).map(({ type, Icon, label }) => <button key={type} className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-caption text-fg-muted hover:bg-bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" disabled={busy} title={label} aria-label={label} onClick={() => void open(type as "file" | "browser" | "terminal")}><Icon className="size-3.5 shrink-0" /><span>{label}</span></button>)}
      </div>}
        <Popover open={adding} onOpenChange={setAdding}><PopoverTrigger asChild><button className={buttonClass}><PlusIcon className="size-4 shrink-0" />{t("resourceRail.addReview")}</button></PopoverTrigger>
          <PopoverContent side="left" align="start" className="w-80">
            <form className="space-y-2" onSubmit={event => { event.preventDefault(); const review = relatedReviews([url.trim()])[0]; if (!review) { setError(t("resourceRail.invalidReview")); return; } const next = [...new Set([...manual, review.url])]; try { localStorage.setItem(storageKey(sessionId), JSON.stringify(next)); setManual(next); setUrl(""); setError(""); setAdding(false); } catch { setError(t("resourceRail.saveFailed")); } }}>
              <label className="block text-caption" htmlFor="related-review-url">{t("resourceRail.reviewUrl")}</label>
              <input id="related-review-url" autoFocus value={url} onChange={event => { setUrl(event.target.value); setError(""); }} className="w-full rounded-lg border border-border bg-bg px-2 py-2 text-caption outline-none focus:ring-2 focus:ring-ring" placeholder="https://…/pull/123" />
              {error && <p role="alert" className="text-caption text-danger">{error}</p>}
              <button type="submit" className={buttonClass}>{t("resourceRail.addReview")}</button>
            </form>
          </PopoverContent>
        </Popover>
    </footer>
    <Dialog open={!!comparison} onOpenChange={(open) => { if (!open) setComparison(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{comparison?.baseBranch} → {comparison?.headBranch}</DialogTitle>
          <DialogDescription>+{comparison?.insertions ?? 0} -{comparison?.deletions ?? 0}</DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-bg-surface p-3 text-xs">{comparison?.files.length ? comparison.files.map((file) => `${file.path} +${file.insertions} -${file.deletions}`).join("\n") : t("resourceRail.noChanges")}</pre>
      </DialogContent>
    </Dialog>
  </nav>;
}

/** Both sources render through the same checkout view. Unknown is never shown as clean. */
function RepositoryEnvironment({ checkout, local, onCompare }: {
  checkout: EnvironmentCheckout; local: boolean; onCompare: (comparison: GitComparison) => void;
}) {
  const { t } = useI18n();
  const { path, repositoryUrl, branch, headSha, changes, reviews, configuredRevision } = checkout;
  return <div data-repository-environment={path} className="rounded-lg border border-border/50 bg-bg-surface/50 px-2 py-1.5">
    <div className="truncate py-1 text-fg-muted" title={path}>{path.split("/").filter(Boolean).pop() || repositoryUrl || path}</div>
    <div className="flex min-w-0 items-center gap-2 text-fg-muted">
      <GitBranchIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{branch ?? (headSha ? headSha.slice(0, 8) : t("resourceRail.unknownBranch"))}</span>
      {changes && <><span className="ml-auto shrink-0 text-[11px] text-[var(--git-add,green)]">+{changes.insertions}</span>
        <span className="shrink-0 text-[11px] text-[var(--git-del,red)]">-{changes.deletions}</span></>}
    </div>
    {repositoryUrl && <p className="mt-1 truncate text-[10px] text-fg-subtle" title={repositoryUrl}>{repositoryUrl}</p>}
    {configuredRevision && <p className="mt-1 truncate text-caption text-fg-muted">{t("resourceRail.configuredRevision")}: {configuredRevision.type === "branch" ? configuredRevision.name : configuredRevision.sha}</p>}
    {checkout.state !== "live" && <p className="mt-1 text-caption text-fg-subtle">{t("resourceRail.liveStateUnavailable")}</p>}
    {local && branch && <button type="button" className="mt-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[11px] text-fg-muted hover:bg-bg-surface hover:text-fg" onClick={() => {
      void window.backchat.uiFsGitCompare({ path, base_branch: "main", head_branch: branch }).then(onCompare).catch(error => toast.error(error instanceof Error ? error.message : String(error)));
    }}><GitCompareArrowsIcon className="size-3.5" />{t("resourceRail.compareBranch")}</button>}
    {reviews?.map(review => <a key={review.url} href={review.url} target="_blank" rel="noreferrer" title={review.title}
      className="mt-1 flex min-w-0 items-center gap-2 rounded-md py-1.5 text-ui text-fg hover:bg-bg-surface">
      {review.state === "merged" ? <GitMergeIcon className="size-4 shrink-0" /> : review.state === "closed" ? <GitPullRequestClosedIcon className="size-4 shrink-0" /> : <GitPullRequestIcon className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{review.kind === "MR" ? "!" : "#"}{review.number} · {review.title}</span>
        <span className="block truncate text-caption text-fg-muted">{[
          t(`resourceRail.reviewState.${review.state === "open" && review.draft ? "draft" : review.state}`),
          review.checks !== "unknown" ? t(`resourceRail.checks.${review.checks}`) : "",
          review.review !== "unknown" ? t(`resourceRail.reviewDecision.${review.review}`) : "",
        ].filter(Boolean).join(" · ")}</span>
      </span>
    </a>)}
  </div>;
}
