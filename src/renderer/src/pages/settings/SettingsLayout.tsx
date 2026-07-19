import { useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ChartColumnIcon,
  CpuIcon,
  InfoIcon,
  PaletteIcon,
  PanelTopIcon,
  SearchIcon,
  ServerIcon,
} from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/lib/i18n";

type SettingsTab = {
  to: string;
  labelKey: TranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  section: "personal" | "integrations" | "archived";
};

const TABS: SettingsTab[] = [
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
const iconSlotClass = "flex w-4 shrink-0 items-center justify-center";

export function SettingsLayout() {
  const location = useLocation();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const visibleTabs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return TABS;
    return TABS.filter((tab) => t(tab.labelKey).toLowerCase().includes(normalized));
  }, [query, t]);

  return (
    <div className="flex h-full min-h-0 gap-[var(--stage-inset)] bg-bg-sidebar p-[var(--stage-inset)] text-fg">
      <aside className="app-drag-region liquid-glass flex w-[232px] shrink-0 flex-col rounded-2xl px-2 pb-2 pt-2">
        <div className="h-[30px]" />
        <Link
          to="/"
          aria-label={t("settings.backToApp")}
          className="app-no-drag mb-2 inline-flex h-7 w-fit items-center gap-2 rounded-md px-2 text-xs text-fg-subtle transition-colors hover:bg-bg-surface/55 hover:text-fg"
        >
          <span className={iconSlotClass}>
            <ArrowLeftIcon className="size-3.5" />
          </span>
          <span>{t("settings.backToApp")}</span>
        </Link>

        <InputGroup className="app-no-drag mb-3 h-8 rounded-lg border-border/45 bg-bg/65 shadow-chip-press">
          <InputGroupAddon className="pl-2 pr-1 text-fg-subtle">
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.search")}
            className="h-8 text-xs text-fg placeholder:text-fg-subtle md:text-xs"
          />
        </InputGroup>

        <nav className="app-no-drag min-h-0 flex-1 overflow-y-auto">
          {SECTION_ORDER.map((section) => {
            const items = visibleTabs.filter((tab) => tab.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-4">
                <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{t(SECTION_LABELS[section])}</div>
                <ul className="space-y-0.5">
                  {items.map((tab) => {
                    const active = location.pathname === tab.to;
                    const Icon = tab.icon;
                    return (
                      <li key={tab.to}>
                        <Link
                          to={tab.to}
                          className={cn(
                            "flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors",
                            active
                              ? "liquid-glass-selected text-fg"
                              : "text-fg-muted hover:bg-bg-surface/65 hover:text-fg",
                          )}
                        >
                          <span className={iconSlotClass}>
                            <Icon className="size-3.5" />
                          </span>
                          <span>{t(tab.labelKey)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto rounded-2xl bg-bg/80 shadow-card-soft">
        <div className="w-full px-8 pb-16 pt-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
