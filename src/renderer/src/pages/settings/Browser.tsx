import { useI18n } from "@/lib/i18n";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderIcon,
  MonitorIcon,
  PanelTopIcon,
  PuzzleIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { browserSettings } from "@shared/browser-settings.js";
import type { SettingsBrowser } from "@shared/settings.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { patchSettings, useSettings } from "@/lib/settings-store";
import {
  deriveBrowserSettingsModel,
  type BrowserSettingsBackend,
  type BrowserSettingsStatus,
} from "./browser-settings";

export function SettingsBrowserPage() {
  const { t } = useI18n();
  const settings = useSettings();
  const [clearing, setClearing] = useState(false);
  const {
    data: browserBackends = [],
    error: browserBackendsError,
    isFetching: browserBackendsFetching,
    refetch: refetchBrowserBackends,
  } = useQuery({
    queryKey: ["browser", "settings"],
    queryFn: () => window.backchat.browserList(),
    refetchInterval: 2_000,
  });
  const browserBackendsModel = useMemo(
    () => deriveBrowserSettingsModel(browserBackends),
    [browserBackends],
  );
  if (!settings) return null;

  const browser = browserSettings(settings.browser);
  const update = (patch: Partial<SettingsBrowser>) => {
    void patchSettings({ browser: { ...browser, ...patch } });
  };
  const chooseDownloadFolder = async () => {
    const selected = await window.backchat.uiFsPickDir({
      defaultPath: browser.download_path || undefined,
    });
    if (selected) update({ download_path: selected });
  };
  const clearSiteData = async () => {
    setClearing(true);
    try {
      await window.backchat.browserClearProfileData({ kinds: ["cookies", "cache"] });
      toast.success("Browser site data cleared");
    } catch (error) {
      toast.error("Could not clear browser data", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-7 text-xs">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-medium text-fg">Browser</h1>
          <p className="mt-1 text-[11px] text-fg-muted">
            Manage the task-scoped browser and agent-facing browser backends.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refetchBrowserBackends()}
          disabled={browserBackendsFetching}
          className="h-7 gap-1.5 px-2 text-xs text-fg-muted hover:text-fg"
        >
          <RefreshCwIcon
            className={cn("size-3.5", browserBackendsFetching && "animate-spin")}
          />
          Refresh
        </Button>
      </header>

      <div className="flex items-center gap-3 rounded-lg border border-border/55 bg-bg/72 px-3.5 py-3 shadow-card-soft">
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-bg-surface text-fg">
          <PanelTopIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg">Built-in browser</div>
          <div className="mt-0.5 text-[11px] text-fg-muted">
            Show browser tabs and allow browser tools in tasks.
          </div>
        </div>
        <Switch
          checked={browser.enabled}
          onCheckedChange={(checked) => update({ enabled: checked })}
          aria-label={t("settings.enableBuiltInBrowser")}
        />
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          <PuzzleIcon className="size-3.5" />
          Backends
        </h2>
        {browserBackendsError && (
          <p className="mb-3 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
            {browserBackendsError instanceof Error
              ? browserBackendsError.message
              : String(browserBackendsError)}
          </p>
        )}
        <div className="space-y-3">
          <BrowserBackendPanel
            title={t("settings.inAppBrowser")}
            icon={<MonitorIcon className="size-4" />}
            backend={browserBackendsModel.inApp}
          />
          <BrowserBackendPanel
            title={t("settings.chromeExtension")}
            icon={<PuzzleIcon className="size-4" />}
            backend={browserBackendsModel.extension}
          />
        </div>
      </section>

      <SettingsSection title={t("settings.general")} icon={<ShieldCheckIcon className="size-3.5" />}>
        <SettingsRow
          title={t("settings.webUrlsAndLinks")}
          description="Links opened from chat"
          control={(
            <TargetSelect
              value={browser.web_link_target}
              onChange={(value) => update({ web_link_target: value })}
            />
          )}
        />
        <SettingsRow
          title={t("settings.localUrls")}
          description="Localhost, loopback, and file links"
          control={(
            <TargetSelect
              value={browser.local_link_target}
              onChange={(value) => update({ local_link_target: value })}
            />
          )}
        />
        <SettingsRow
          title={t("settings.defaultZoom")}
          description="Applied when a browser tab opens"
          control={(
            <CompactSelect
              value={String(browser.default_zoom)}
              onChange={(value) => update({ default_zoom: Number(value) })}
              options={[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((value) => ({
                value: String(value),
                label: `${Math.round(value * 100)}%`,
              }))}
            />
          )}
        />
        <SettingsRow
          title={t("shell.annotationScreenshots")}
          description="Screenshot evidence attached to page annotations"
          control={(
            <CompactSelect
              value={browser.annotation_screenshots}
              onChange={(value) => update({
                annotation_screenshots: value as SettingsBrowser["annotation_screenshots"],
              })}
              options={[
                { value: "always", label: "Always include" },
                { value: "never", label: "Never include" },
              ]}
            />
          )}
        />
        <SettingsRow
          title={t("settings.siteData")}
          description="Cookies, local storage, and cached files"
          control={(
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={clearing}
              loadingLabel="Clearing"
              onClick={() => void clearSiteData()}
            >
              <Trash2Icon />
              Clear
            </Button>
          )}
        />
      </SettingsSection>

      <SettingsSection title={t("settings.downloads")} icon={<DownloadIcon className="size-3.5" />}>
        <SettingsRow
          title={t("settings.location")}
          description={browser.download_path || "System Downloads folder"}
          descriptionMono={!!browser.download_path}
          control={(
            <Button type="button" size="sm" variant="outline" onClick={() => void chooseDownloadFolder()}>
              <FolderIcon />
              Change
            </Button>
          )}
        />
        <SettingsRow
          title={t("settings.askWhereToSaveFile")}
          description="Show a save dialog before downloads begin"
          control={(
            <Switch
              checked={browser.ask_before_download}
              onCheckedChange={(checked) => update({ ask_before_download: checked })}
              aria-label={t("settings.askWhereToSaveDownload")}
            />
          )}
        />
      </SettingsSection>
    </div>
  );
}

function BrowserBackendPanel({
  title,
  icon,
  backend,
}: {
  title: string;
  icon: ReactNode;
  backend: BrowserSettingsBackend;
}) {
  const copyLoadPath = async () => {
    if (!backend.loadPath) return;
    await navigator.clipboard?.writeText(backend.loadPath);
  };

  return (
    <section className="rounded-lg border border-border/55 bg-bg/72 p-4 shadow-card-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-bg-surface text-fg-muted">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-fg">{title}</h3>
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
          <div key={row.label} className="min-w-0 rounded-md bg-bg-surface/45 px-3 py-2">
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
            onClick={() => void copyLoadPath()}
            className="h-7 gap-1.5 bg-bg-surface/45 px-2 text-xs text-fg-muted hover:bg-bg-surface hover:text-fg"
          >
            <CopyIcon className="size-3.5" />
            Copy path
          </Button>
          <a
            href="chrome://extensions"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted transition-colors hover:bg-bg-surface/45 hover:text-fg"
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

function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
        {icon}
        {title}
      </h2>
      <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/55 bg-bg/72 shadow-card-soft">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  descriptionMono = false,
  control,
}: {
  title: string;
  description: string;
  descriptionMono?: boolean;
  control: ReactNode;
}) {
  return (
    <div className="flex min-h-[58px] items-center gap-5 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">{title}</div>
        <div className={descriptionMono
          ? "mt-0.5 truncate font-mono text-[10px] text-fg-muted"
          : "mt-0.5 text-[11px] text-fg-muted"}
        >
          {description}
        </div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function TargetSelect({
  value,
  onChange,
}: {
  value: SettingsBrowser["web_link_target"];
  onChange: (value: SettingsBrowser["web_link_target"]) => void;
}) {
  return (
    <CompactSelect
      value={value}
      onChange={(next) => onChange(next as SettingsBrowser["web_link_target"])}
      options={[
        { value: "external", label: "Default browser" },
        { value: "in_app", label: "Built-in browser" },
      ]}
    />
  );
}

function CompactSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-[150px] bg-bg text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
