import { useState, type ReactNode } from "react";
import {
  DownloadIcon,
  FolderIcon,
  PanelTopIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { browserSettings } from "@shared/browser-settings.js";
import type { SettingsBrowser } from "@shared/settings.js";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { patchSettings, useSettings } from "@/lib/settings-store";

export function SettingsBrowserPage() {
  const settings = useSettings();
  const [clearing, setClearing] = useState(false);
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
      <header>
        <h1 className="text-base font-medium text-fg">Browser</h1>
        <p className="mt-1 text-[11px] text-fg-muted">
          Manage the task-scoped built-in browser.
        </p>
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
          aria-label="Enable built-in browser"
        />
      </div>

      <SettingsSection title="General" icon={<ShieldCheckIcon className="size-3.5" />}>
        <SettingsRow
          title="Web URLs and links"
          description="Links opened from chat"
          control={(
            <TargetSelect
              value={browser.web_link_target}
              onChange={(value) => update({ web_link_target: value })}
            />
          )}
        />
        <SettingsRow
          title="Local URLs"
          description="Localhost, loopback, and file links"
          control={(
            <TargetSelect
              value={browser.local_link_target}
              onChange={(value) => update({ local_link_target: value })}
            />
          )}
        />
        <SettingsRow
          title="Default zoom"
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
          title="Annotation screenshots"
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
          title="Site data"
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

      <SettingsSection title="Downloads" icon={<DownloadIcon className="size-3.5" />}>
        <SettingsRow
          title="Location"
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
          title="Ask where to save each file"
          description="Show a save dialog before downloads begin"
          control={(
            <Switch
              checked={browser.ask_before_download}
              onCheckedChange={(checked) => update({ ask_before_download: checked })}
              aria-label="Ask where to save each download"
            />
          )}
        />
      </SettingsSection>
    </div>
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
