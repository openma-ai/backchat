import { useEffect, useState, type ReactNode } from "react";
import {
  BlocksIcon,
  CalendarClockIcon,
  PackageIcon,
  PanelTopIcon,
  PaintbrushIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { browserSettings } from "@shared/browser-settings.js";
import type { SkillsPluginsCatalog } from "@shared/skill-plugins.js";
import { skillsPluginsSettings } from "@shared/settings.js";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { patchSettings, useSettings } from "@/lib/settings-store";
import { toggleDisabledPlugin } from "./skills-plugins-settings.js";

export function SettingsSkillsPlugins() {
  const settings = useSettings();
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<SkillsPluginsCatalog | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;
    void window.backchat.skillsPluginsList()
      .then((next) => {
        if (mounted) setCatalog(next);
      })
      .catch((error) => {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!settings) return null;
  const browser = browserSettings(settings.browser);
  const capabilities = skillsPluginsSettings(settings.skills_plugins);
  const updateCapabilities = (
    patch: Partial<typeof capabilities>,
  ) => void patchSettings({
    skills_plugins: { ...capabilities, ...patch },
  });

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-7 text-xs">
      <header>
        <h1 className="text-base font-medium text-fg">{t("skillsPlugins.title")}</h1>
        <p className="mt-1 max-w-[68ch] text-[11px] leading-5 text-fg-muted">
          {t("skillsPlugins.description")}
        </p>
        <p className="mt-1 text-[10px] text-fg-subtle">
          {t("skillsPlugins.newSessions")}
        </p>
      </header>

      <SettingsSection
        title={t("skillsPlugins.builtIns")}
        icon={<BlocksIcon className="size-3.5" />}
      >
        <CapabilityRow
          icon={<PanelTopIcon className="size-4" />}
          title={t("skillsPlugins.browser")}
          description={t("skillsPlugins.browserDescription")}
          checked={browser.enabled}
          onCheckedChange={(enabled) => void patchSettings({
            browser: { ...browser, enabled },
          })}
        />
        <CapabilityRow
          icon={<CalendarClockIcon className="size-4" />}
          title={t("skillsPlugins.schedules")}
          description={t("skillsPlugins.schedulesDescription")}
          checked={capabilities.schedules_enabled}
          onCheckedChange={(schedules_enabled) =>
            updateCapabilities({ schedules_enabled })}
        />
        <CapabilityRow
          icon={<PaintbrushIcon className="size-4" />}
          title={t("skillsPlugins.bundledSkills")}
          description={t("skillsPlugins.bundledSkillsDescription")}
          detail={catalog?.bundled_skills.map((skill) => skill.name).join(", ")}
          checked={capabilities.bundled_skills_enabled}
          onCheckedChange={(bundled_skills_enabled) =>
            updateCapabilities({ bundled_skills_enabled })}
        />
      </SettingsSection>

      <section>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
              <PackageIcon className="size-3.5" />
              {t("skillsPlugins.installed")}
            </h2>
            <p className="mt-1 text-[10px] text-fg-subtle">
              {t("skillsPlugins.installedDescription")}
            </p>
          </div>
          {catalog && (
            <Badge variant="secondary" className="text-[10px]">
              {catalog.installed_plugins.length}
            </Badge>
          )}
        </div>

        {loadError && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-3 text-danger">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {!loadError && !catalog && (
          <div className="rounded-lg border border-border/55 bg-bg/72 px-3.5 py-5 text-center text-fg-muted shadow-card-soft">
            {t("common.loading")}
          </div>
        )}

        {catalog && catalog.installed_plugins.length === 0 && (
          <div className="rounded-lg border border-border/55 bg-bg/72 px-3.5 py-5 text-center text-fg-muted shadow-card-soft">
            <div>{t("skillsPlugins.noneInstalled")}</div>
            <div className="mt-1 font-mono text-[10px] text-fg-subtle">
              ~/.oma/plugins
            </div>
          </div>
        )}

        {catalog && catalog.installed_plugins.length > 0 && (
          <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/55 bg-bg/72 shadow-card-soft">
            {catalog.installed_plugins.map((plugin) => {
              const enabled = !capabilities.disabled_plugins.includes(plugin.id);
              const details = [
                plugin.skill_count > 0 ? `${plugin.skill_count} skills` : "",
                plugin.mcp_server_count > 0 ? `${plugin.mcp_server_count} MCP` : "",
                plugin.app_count > 0 ? `${plugin.app_count} apps` : "",
              ].filter(Boolean).join(" · ");
              return (
                <CapabilityRow
                  key={plugin.id}
                  icon={<PackageIcon className="size-4" />}
                  title={plugin.name}
                  description={plugin.description || plugin.id}
                  detail={details || plugin.version}
                  checked={enabled}
                  onCheckedChange={(nextEnabled) => updateCapabilities({
                    disabled_plugins: toggleDisabledPlugin(
                      capabilities.disabled_plugins,
                      plugin.id,
                      nextEnabled,
                    ),
                  })}
                />
              );
            })}
          </div>
        )}

        {catalog && catalog.errors.length > 0 && (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3.5 py-3 text-[10px] text-fg-muted">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
              <TriangleAlertIcon className="size-3.5" />
              {t("skillsPlugins.loadErrors")}
            </div>
            {catalog.errors.map((error) => (
              <div key={`${error.root}:${error.message}`} className="truncate font-mono">
                {error.root}: {error.message}
              </div>
            ))}
          </div>
        )}
      </section>
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

function CapabilityRow({
  icon,
  title,
  description,
  detail,
  checked,
  onCheckedChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  detail?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-[64px] items-center gap-3 px-3.5 py-2.5">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-bg-surface text-fg-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">{title}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-fg-muted">
          {description}
        </div>
        {detail && (
          <div className="mt-1 truncate font-mono text-[10px] text-fg-subtle">
            {detail}
          </div>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={`${checked ? "Disable" : "Enable"} ${title}`}
      />
    </div>
  );
}
