/**
 * Router — TanStack Router, code-based (no file-based generator). Routes:
 *
 *   /                              chat home (no session)
 *   /chat/$sessionId               single session view
 *   /settings                      → redirect /settings/activity
 *   /settings/activity             local activity + harness analytics
 *   /settings/agents               default-agent picker + per-agent overrides
 *   /settings/mcp-servers          MCP server CRUD
 *   /settings/appearance           theme / font / density
 *   /settings/about                version + diagnostics
 *
 * The `__root` route renders <AppShell> with sidebar + topbar; all child
 * routes go in the `<main>` outlet. AppShell-level state (active session,
 * settings) is read from stores via hooks, not router context.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { ChatPage } from "@/pages/ChatPage";
import { PairChatPage } from "@/pages/PairChatPage";
import { ShellLayout } from "@/components/shell/ShellLayout";
import { SettingsAgents } from "@/pages/settings/Agents";
import { SettingsAppearance } from "@/pages/settings/Appearance";
import { SettingsBrowserPage } from "@/pages/settings/Browser";
import { SettingsAbout } from "@/pages/settings/About";
import { SettingsMcpServers } from "@/pages/settings/McpServers";
import { Archive as SettingsArchive } from "@/pages/settings/Archive";
import { SettingsLayout } from "@/pages/settings/SettingsLayout";
import { SettingsActivity } from "@/pages/settings/Activity";
import { ScheduledPage } from "@/pages/Scheduled";

function RootRoute() {
  const location = useLocation();
  const outlet = <Outlet />;
  if (location.pathname.startsWith("/settings")) return outlet;
  return <ShellLayout>{outlet}</ShellLayout>;
}

const rootRoute = createRootRoute({
  component: RootRoute,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ChatPage,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$sessionId",
  component: ChatPage,
});

const pairRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pair/$pairId",
  component: PairChatPage,
});

const scheduledRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scheduled",
  component: ScheduledPage,
});

const settingsRoot = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsLayout,
  // Bare `/settings` → first sub-page. Saves the user a redundant click and
  // keeps the URL stable (settings tabs each have their own path).
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/+$/, "") === "/settings") {
      throw redirect({ to: "/settings/activity" });
    }
  },
});

const settingsAgents = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/agents",
  component: SettingsAgents,
});
const settingsActivity = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/activity",
  component: SettingsActivity,
});
const settingsMcp = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/mcp-servers",
  component: SettingsMcpServers,
});
const settingsAppearance = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/appearance",
  component: SettingsAppearance,
});
const settingsBrowser = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/browser",
  component: SettingsBrowserPage,
});
const settingsAbout = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/about",
  component: SettingsAbout,
});
const settingsArchive = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/archive",
  component: SettingsArchive,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  chatRoute,
  pairRoute,
  scheduledRoute,
  settingsRoot.addChildren([
    settingsActivity,
    settingsAgents,
    settingsMcp,
    settingsBrowser,
    settingsAppearance,
    settingsArchive,
    settingsAbout,
  ]),
]);

// Use memory history — Electron's renderer is loaded via file:// in
// production, where the History API doesn't behave like a real web server
// (back/forward over /chat/foo would reload the file URL with no
// information). Memory history sidesteps the platform mismatch and we lose
// nothing — there's no browser address bar to reflect the route into.
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
