import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { CpuIcon, InfoIcon, PaletteIcon, ServerIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Settings layout — left subsection nav + right outlet for the active tab.
 *
 * Reuses the floating-card surface inside main rather than introducing its
 * own card boundary. The sub-nav lives flush with the topbar so the visual
 * weight stays on the active page's content.
 */
const TABS: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { to: "/settings/agents", label: "Agents", icon: CpuIcon },
  { to: "/settings/mcp-servers", label: "MCP Servers", icon: ServerIcon },
  { to: "/settings/appearance", label: "Appearance", icon: PaletteIcon },
  { to: "/settings/about", label: "About", icon: InfoIcon },
];

export function SettingsLayout() {
  const location = useLocation();
  return (
    <div className="grid h-full min-h-0 grid-cols-[180px_1fr]">
      <nav className="overflow-y-auto px-3 py-4">
        <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          Settings
        </div>
        <ul className="space-y-0.5">
          {TABS.map((t) => {
            const active = location.pathname === t.to;
            const Icon = t.icon;
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                    active
                      ? "bg-bg-surface text-fg"
                      : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5" />
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
