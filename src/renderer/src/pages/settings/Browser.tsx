import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PuzzleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deriveBrowserSettingsModel,
  type BrowserSettingsBackend,
  type BrowserSettingsStatus,
} from "./browser-settings";

export function SettingsBrowser() {
  const {
    data: browsers = [],
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["browser", "settings"],
    queryFn: () => window.backchat.browserList(),
    refetchInterval: 2_000,
  });
  const model = useMemo(() => deriveBrowserSettingsModel(browsers), [browsers]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-medium text-fg">Browser</h1>
          <p className="mt-1 max-w-[58ch] text-xs leading-5 text-fg-muted">
            Browser tool backends exposed to agents and local MCP clients.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="h-7 gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"
        >
          <RefreshCwIcon className={cn("size-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {error && (
        <p className="rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      <div className="space-y-3">
        <BrowserBackendPanel
          title="In-app browser"
          icon={<MonitorIcon className="size-4" />}
          backend={model.inApp}
        />
        <BrowserBackendPanel
          title="Chrome extension"
          icon={<PuzzleIcon className="size-4" />}
          backend={model.extension}
        />
      </div>
    </div>
  );
}

function BrowserBackendPanel({
  title,
  icon,
  backend,
}: {
  title: string;
  icon: React.ReactNode;
  backend: BrowserSettingsBackend;
}) {
  const copyLoadPath = async () => {
    if (!backend.loadPath) return;
    await navigator.clipboard?.writeText(backend.loadPath);
  };

  return (
    <section className="rounded-lg bg-bg-surface/45 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-bg/70 text-fg-muted">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-fg">{title}</h2>
              <StatusBadge status={backend.status} label={backend.statusLabel} />
            </div>
            <p className="mt-1 text-xs leading-5 text-fg-muted">{backend.summary}</p>
          </div>
        </div>
        {backend.status === "connected" && (
          <CheckCircle2Icon className="mt-1 size-4 shrink-0 text-success" />
        )}
      </div>

      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        {backend.rows.map((row) => (
          <div key={row.label} className="min-w-0 rounded-md bg-bg/45 px-3 py-2">
            <dt className="text-[11px] text-fg-subtle">{row.label}</dt>
            <dd className="mt-0.5 truncate font-mono text-fg" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {backend.loadPath && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={copyLoadPath}
            className="h-7 gap-1.5 bg-bg/45 px-2 text-xs text-fg-muted hover:bg-bg hover:text-fg"
          >
            <CopyIcon className="size-3.5" />
            Copy path
          </Button>
          <a
            href="chrome://extensions"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted transition-colors hover:bg-bg/45 hover:text-fg"
          >
            <ExternalLinkIcon className="size-3.5" />
            Chrome extensions
          </a>
        </div>
      )}

      {backend.requiredPermissions && (
        <div className="mt-3 border-t border-border/40 pt-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            Required permissions
          </div>
          <div className="flex flex-wrap gap-1.5">
            {backend.requiredPermissions.map((permission) => (
              <Badge
                key={permission}
                variant="secondary"
                className="h-5 rounded-md font-mono text-[11px]"
              >
                {permission}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status, label }: { status: BrowserSettingsStatus; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium",
        status === "connected" && "bg-success-subtle text-success",
        status === "available" && "bg-brand-subtle text-brand",
        status === "error" && "bg-danger-subtle text-danger",
        status === "waiting" && "bg-warning-subtle text-warning",
        status === "unavailable" && "bg-danger-subtle text-danger",
      )}
    >
      {label}
    </span>
  );
}
