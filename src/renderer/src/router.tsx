/**
 * Router — TanStack Router, code-based (no file-based generator). Routes:
 *
 *   /                              chat home (no session)
 *   /chat/$sessionId               single session view
 *   /settings                      → redirect /settings/agents
 *   /settings/agents               default-agent picker + per-agent overrides
 *   /settings/browser              Browser plugin backend status
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
import { SettingsAbout } from "@/pages/settings/About";
import { SettingsBrowser } from "@/pages/settings/Browser";
import { SettingsMcpServers } from "@/pages/settings/McpServers";
import { Archive as SettingsArchive } from "@/pages/settings/Archive";
import { SettingsLayout } from "@/pages/settings/SettingsLayout";

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

const settingsRoot = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsLayout,
  // Bare `/settings` → first sub-page. Saves the user a redundant click and
  // keeps the URL stable (settings tabs each have their own path).
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/agents" });
    }
  },
});

const settingsAgents = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/agents",
  component: SettingsAgents,
});
const settingsMcp = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/mcp-servers",
  component: SettingsMcpServers,
});
const settingsBrowser = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/browser",
  component: SettingsBrowser,
});
const settingsAppearance = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/appearance",
  component: SettingsAppearance,
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
  settingsRoot.addChildren([
    settingsAgents,
    settingsBrowser,
    settingsMcp,
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
