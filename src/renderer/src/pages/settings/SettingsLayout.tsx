import { useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  BotIcon,
  CpuIcon,
  Globe2Icon,
  InfoIcon,
  PaletteIcon,
  SearchIcon,
  ServerIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SettingsTab = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section: "Personal" | "Integrations" | "Archived";
};

const TABS: SettingsTab[] = [
  { to: "/settings/agents", label: "Agents", icon: CpuIcon, section: "Personal" },
  { to: "/settings/appearance", label: "Appearance", icon: PaletteIcon, section: "Personal" },
  { to: "/settings/browser", label: "Browser", icon: Globe2Icon, section: "Integrations" },
  { to: "/settings/mcp-servers", label: "MCP Servers", icon: ServerIcon, section: "Integrations" },
  { to: "/settings/archive", label: "Archived chats", icon: ArchiveIcon, section: "Archived" },
  { to: "/settings/about", label: "About", icon: InfoIcon, section: "Archived" },
];

const SECTION_ORDER: SettingsTab["section"][] = ["Personal", "Integrations", "Archived"];
const iconSlotClass = "flex w-5 shrink-0 items-center justify-center";

export function SettingsLayout() {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const visibleTabs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return TABS;
    return TABS.filter((tab) => tab.label.toLowerCase().includes(normalized));
  }, [query]);

  return (
    <div className="flex h-full min-h-0 bg-bg text-fg">
      <aside className="app-drag-region flex w-[348px] shrink-0 flex-col bg-bg-sidebar/80 px-8 pb-6 pt-12">
        <Link
          to="/"
          aria-label="Back to app"
          className="app-no-drag mb-5 inline-flex h-7 w-fit items-center gap-2 rounded-md px-2 text-sm text-fg-subtle transition-colors hover:text-fg"
        >
          <span className={iconSlotClass}>
            <ArrowLeftIcon className="size-3.5" />
          </span>
          <span>Back to app</span>
        </Link>

        <label className="app-no-drag mb-6 flex h-8 items-center gap-2 rounded-lg bg-bg px-2 text-sm shadow-sm ring-1 ring-border/60 transition-colors focus-within:ring-border-strong">
          <span className={cn(iconSlotClass, "text-fg-subtle")}>
            <SearchIcon className="size-3.5" />
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings..."
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
          />
        </label>

        <nav className="app-no-drag min-h-0 flex-1 overflow-y-auto">
          {SECTION_ORDER.map((section) => {
            const items = visibleTabs.filter((tab) => tab.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-7">
                <div className="mb-2 px-2 text-sm text-fg-subtle">{section}</div>
                <ul className="space-y-1">
                  {items.map((tab) => {
                    const active = location.pathname === tab.to;
                    const Icon = tab.icon;
                    return (
                      <li key={tab.to}>
                        <Link
                          to={tab.to}
                          className={cn(
                            "flex h-8 items-center gap-2 rounded-lg px-2 text-sm transition-colors",
                            active
                              ? "bg-bg-surface text-fg"
                              : "text-fg-muted hover:bg-bg-surface/65 hover:text-fg",
                          )}
                        >
                          <span className={iconSlotClass}>
                            <Icon className="size-4" />
                          </span>
                          <span>{tab.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="app-no-drag mt-auto rounded-lg bg-bg-surface/55 py-2 text-sm text-fg-muted">
          <div className="flex items-center gap-2 px-2">
            <span className={iconSlotClass}>
              <BotIcon className="size-4" />
            </span>
            <span>Chat settings</span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[780px] px-8 pb-24 pt-24">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
