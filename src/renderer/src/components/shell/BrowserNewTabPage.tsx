import { useMemo, useState } from "react";
import { GlobeIcon, XIcon } from "@/components/Icons";
import { removeBrowserVisit, useBrowserHistory, visitKey } from "@/lib/browser-history";
import { useI18n } from "@/lib/i18n";
import { selectArtifactsFor, useSessionStore } from "@/lib/session-store";

interface PageLink {
  url: string;
  title?: string;
  faviconUrl?: string;
}

const LOCAL_HOST_RE = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/;

function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return url;
  }
}

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * What an empty browser tab shows instead of a white page: pages this task
 * touched (local dev servers first, then fetched web sources) and the pages
 * the user visited recently. The address bar above stays the primary input;
 * this page only offers somewhere to go.
 */
export function BrowserNewTabPage({
  sessionId,
  onOpen,
}: {
  sessionId: string | null;
  onOpen: (url: string) => void;
}) {
  const { t } = useI18n();
  const history = useBrowserHistory();
  const artifactsSelector = useMemo(() => selectArtifactsFor(sessionId), [sessionId]);
  const artifacts = useSessionStore(artifactsSelector);

  const taskPages = useMemo<PageLink[]>(() => {
    const seen = new Set<string>();
    const pages: PageLink[] = [];
    const push = (page: PageLink) => {
      const key = visitKey(page.url);
      if (seen.has(key) || !/^https?:\/\//i.test(page.url)) return;
      seen.add(key);
      pages.push(page);
    };
    // Dev servers the agent started are the likeliest destination.
    for (const url of artifacts.services) push({ url });
    for (const source of artifacts.sources) {
      if (source.kind === "web") push({ url: source.uri, title: source.label });
    }
    return pages.sort((a, b) => Number(isLocal(b.url)) - Number(isLocal(a.url))).slice(0, 8);
  }, [artifacts.services, artifacts.sources]);

  const taskKeys = useMemo(() => new Set(taskPages.map((page) => visitKey(page.url))), [taskPages]);
  const recent = history.filter((visit) => !taskKeys.has(visitKey(visit.url))).slice(0, 8);

  if (taskPages.length === 0 && recent.length === 0) {
    return (
      <div
        data-browser-new-tab="empty"
        className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <GlobeIcon className="size-5 text-fg-subtle" aria-hidden="true" />
        <p className="text-xs text-fg-muted">{t("browserNewTab.empty")}</p>
      </div>
    );
  }

  return (
    <div data-browser-new-tab="list" className="oma-scrollbar h-full overflow-y-auto pb-8 pt-3">
      <div className="space-y-4">
        {taskPages.length > 0 && (
          <PageSection title={t("browserNewTab.thisTask")}>
            {taskPages.map((page) => (
              <PageRow key={page.url} page={page} onOpen={onOpen} />
            ))}
          </PageSection>
        )}
        {recent.length > 0 && (
          <PageSection title={t("browserNewTab.recent")}>
            {recent.map((visit) => (
              <PageRow
                key={visit.url}
                page={visit}
                onOpen={onOpen}
                onRemove={() => removeBrowserVisit(visit.url)}
                removeLabel={t("browserNewTab.remove")}
              />
            ))}
          </PageSection>
        )}
      </div>
    </div>
  );
}

function PageSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pl-2.5 pr-2">
      <h2 className="ml-2 text-xs font-medium text-fg-muted">{title}</h2>
      <div className="mt-1 space-y-0.5">{children}</div>
    </section>
  );
}

function PageRow({
  page,
  onOpen,
  onRemove,
  removeLabel,
}: {
  page: PageLink;
  onOpen: (url: string) => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const host = hostOf(page.url);
  const label = page.title?.trim() || host;
  return (
    <div className="group relative">
      <button
        type="button"
        title={`${label}\n${page.url}`}
        onClick={() => onOpen(page.url)}
        className="grid h-8 w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-md pr-8 text-left text-sm text-fg transition-colors hover:bg-[var(--control-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center text-fg-subtle">
          <Favicon src={page.faviconUrl} />
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          {/* The title keeps priority; the address yields first. */}
          <span className="min-w-0 max-w-[70%] shrink-0 truncate">{label}</span>
          {label !== host && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">{host}</span>
          )}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={onRemove}
          className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Favicon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <GlobeIcon className="size-4" aria-hidden="true" />;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="size-4 rounded-[3px] object-contain"
    />
  );
}
