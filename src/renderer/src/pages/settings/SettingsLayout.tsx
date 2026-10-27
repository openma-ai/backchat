import { ProjectIcon } from "@/components/ProjectIcon";
import { useProjects } from "@/lib/projects-query";
import { ArchiveIcon, PaletteIcon } from "@/components/BackchatIcons";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChartColumnIcon,
  CpuIcon,
  InfoIcon,
  PanelTopIcon,
  ServerIcon,
} from "@/components/Icons";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchField } from "@/components/ui/search-field";
import { ContentPage, PAGE_SCAFFOLD_CLASS } from "@/components/shell/PageScaffold";
import { ScrollArea } from "@/components/ui/scroll-area";
import { composerBoxClass } from "@/lib/composer-box";
import { sidebarNavRowClass } from "@/lib/sidebar-nav-row";
import { SidebarGridCell, SidebarGridRow } from "@/components/shell/SidebarGridRow";
import { useI18n, type TranslationKey } from "@/lib/i18n";

type SettingsTab = {
  to: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  section: "personal" | "integrations" | "archived";
};

const TABS: SettingsTab[] = [
  { to: "/settings/openma", labelKey: "settings.openma", icon: ServerIcon, section: "personal" },
  { to: "/settings/activity", labelKey: "settings.activity", icon: ChartColumnIcon, section: "personal" },
  { to: "/settings/agents", labelKey: "settings.agents", icon: CpuIcon, section: "personal" },
  { to: "/settings/appearance", labelKey: "settings.appearance", icon: PaletteIcon, section: "personal" },
  { to: "/settings/mcp-servers", labelKey: "settings.mcpServers", icon: ServerIcon, section: "integrations" },
  { to: "/settings/browser", labelKey: "settings.browser", icon: PanelTopIcon, section: "integrations" },
  { to: "/settings/archive", labelKey: "settings.archivedChats", icon: ArchiveIcon, section: "archived" },
  { to: "/settings/about", labelKey: "settings.about", icon: InfoIcon, section: "archived" },
];

const SECTION_ORDER: SettingsTab["section"][] = ["personal", "integrations", "archived"];
const SECTION_LABELS: Record<SettingsTab["section"], TranslationKey> = {
  personal: "settings.personal",
  integrations: "settings.integrations",
  archived: "settings.archived",
};

const SETTINGS_PANEL_LOADERS = [
  () => import("./Activity"),
  () => import("./Agents"),
  () => import("./Appearance"),
  () => import("./Archive"),
  () => import("./Browser"),
  () => import("./McpServers"),
  () => import("./OpenMA"),
  () => import("./About"),
];

export function SettingsLayout() {
  // Warm every panel as soon as settings opens. React.lazy suspends the
  // outlet the first time each chunk is missing, which replaces the whole
  // page (title included) with the loading skeleton. Loading them together
  // means a later tab switch does not do that again.
  useEffect(() => {
    for (const load of SETTINGS_PANEL_LOADERS) void load();
  }, []);
  return (
    <ContentPage>
      <Suspense fallback={<SettingsLoadingPanel />}>
        <Outlet />
      </Suspense>
    </ContentPage>
  );
}

function SettingsLoadingPanel() {
  const { t } = useI18n();
  return (
    <div data-settings-loading="true" role="status" aria-label={t("common.loadingShort")}
      className={PAGE_SCAFFOLD_CLASS} aria-busy="true">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-64 max-w-full" />
      {[0, 1, 2].map(key => <div key={key} className={composerBoxClass({ className: "space-y-4 p-5" })}>
        <Skeleton className="h-4 w-40" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-2/3" />
      </div>)}
    </div>
  );
}

export function SettingsSidebar({ returnTo = "/" }: { returnTo?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const projects = useProjects();
  const visibleTabs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return TABS;
    return TABS.filter((tab) => t(tab.labelKey).toLowerCase().includes(normalized));
  }, [query, t]);
  const backToApp = () => {
    void navigate({ to: returnTo as never });
  };

  return (
    <div className="sidebar-navigation flex h-full min-h-0 flex-col text-ui text-fg">
      {/* macOS traffic-light spacer; collapsed on linux/windows (see index.css). */}
      <div className="app-drag-region h-[36px] shrink-0" data-traffic-light-spacer="" />
      <div className="sidebar-content-inset pt-[var(--row-gap-y)]">
        <SidebarGridRow
          as="button"
          type="button"
          trailingTrack="none"
          onClick={backToApp}
          aria-label={t("settings.backToApp")}
          className={sidebarNavRowClass({
            active: false,
            // Leaving settings is non-essential (Esc and the icon carry it):
            // quaternary tier, one full step under the tertiary nav rows.
            className: "app-no-drag mb-2 w-fit text-fg-faint",
          })}
        >
          <SidebarGridCell slot="icon">
            <span className="sidebar-row-icon">
              <ArrowLeftIcon />
            </span>
          </SidebarGridCell>
          <SidebarGridCell slot="label">
            <span className="min-w-0 truncate">{t("settings.backToApp")}</span>
          </SidebarGridCell>
        </SidebarGridRow>

        <SearchField className="app-no-drag mb-3">
          <input
            className="!text-ui"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.search")}
            aria-label={t("settings.search")}
          />
        </SearchField>
      </div>

      <ScrollArea
        type="always"
        data-settings-sidebar-scroll-area="true"
        className="sidebar-scroll-area app-no-drag min-h-0 flex-1"
      >
        <nav className="sidebar-content-inset">
          {SECTION_ORDER.map((section) => {
            const items = visibleTabs.filter((tab) => tab.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="sidebar-group">
                <div className="sidebar-group-label">{t(SECTION_LABELS[section])}</div>
                <ul className="space-y-0.5">
                  {items.map((tab) => {
                    const active = location.pathname === tab.to;
                    const Icon = tab.icon;
                    return (
                      <li key={tab.to}>
                        <SidebarGridRow asChild trailingTrack="none" className={sidebarNavRowClass({ active })}>
                          <Link to={tab.to}>
                            <SidebarGridCell slot="icon">
                              <span className="sidebar-row-icon">
                                <Icon />
                              </span>
                            </SidebarGridCell>
                            <SidebarGridCell slot="label">
                              <span className="min-w-0 truncate">{t(tab.labelKey)}</span>
                            </SidebarGridCell>
                          </Link>
                        </SidebarGridRow>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {!!projects.data?.length && <div className="sidebar-group">
            <div className="sidebar-group-label">{t("sidebar.projects")}</div>
            <ul className="space-y-0.5">{projects.data.filter(project => project.name.toLowerCase().includes(query.trim().toLowerCase())).map(project => <li key={project.id}>
              <SidebarGridRow asChild trailingTrack="none" className={sidebarNavRowClass({ active: location.pathname === `/settings/projects/${project.id}` })}>
                <Link to="/settings/projects/$projectId" params={{ projectId: project.id }}>
                  <SidebarGridCell slot="icon">
                    <ProjectIcon identity={`project:${project.id}`} name={project.name} sourceFolders={project.source_folders} primaryRoot={project.primary_folder} className="sidebar-row-icon" />
                  </SidebarGridCell>
                  <SidebarGridCell slot="label">
                    <span className="min-w-0 truncate">{project.name}</span>
                  </SidebarGridCell>
                </Link>
              </SidebarGridRow>
            </li>)}</ul>
          </div>}
        </nav>
      </ScrollArea>
    </div>
  );
}
