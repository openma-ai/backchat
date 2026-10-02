/**
 * Router — TanStack Router, code-based (no file-based generator). Routes:
 *
 *   /                              chat home (no session)
 *   /chat/$sessionId               single session view
 *   /settings                      → redirect /settings/activity
 *   /settings/activity             local activity + harness analytics
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

import { lazy } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { ChatPage } from "@/pages/ChatPage";
import { NewChatPage } from "@/pages/NewChatPage";
import { PairChatPage } from "@/pages/PairChatPage";
import { ShellLayout } from "@/components/shell/ShellLayout";
import { SettingsLayout } from "@/pages/settings/SettingsLayout";
import { ProjectSettingsPage } from "@/pages/settings/ProjectSettings";
import { ProjectsPage } from "@/pages/Projects";
import { ExternalCoordinatorPage } from "@/pages/ExternalCoordinator";
import { ScheduledPage } from "@/pages/Scheduled";

// Keep the settings shell synchronous; panels load inside its Suspense boundary.
const SettingsAgents = lazy(() => import("@/pages/settings/Agents").then(module => ({ default: module.SettingsAgents })));
const SettingsAppearance = lazy(() => import("@/pages/settings/Appearance").then(module => ({ default: module.SettingsAppearance })));
const SettingsBrowserPage = lazy(() => import("@/pages/settings/Browser").then(module => ({ default: module.SettingsBrowserPage })));
const SettingsAbout = lazy(() => import("@/pages/settings/About").then(module => ({ default: module.SettingsAbout })));
const SettingsMcpServers = lazy(() => import("@/pages/settings/McpServers").then(module => ({ default: module.SettingsMcpServers })));
const SettingsArchive = lazy(() => import("@/pages/settings/Archive").then(module => ({ default: module.Archive })));
const SettingsOpenMA = lazy(() => import("@/pages/settings/OpenMA").then(module => ({ default: module.SettingsOpenMA })));
const SettingsActivity = lazy(() => import("@/pages/settings/Activity").then(module => ({ default: module.SettingsActivity })));

function RootRoute() {
  return (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  );
}

const rootRoute = createRootRoute({
  component: RootRoute,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: NewChatPage,
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

const projectsRoute = createRoute({getParentRoute: () => rootRoute, path: "/projects", component: ProjectsPage});
const projectRoute = createRoute({getParentRoute: () => rootRoute, path: "/projects/$projectId", component: ProjectsPage});
const externalCoordinatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/coordinators/$coordinatorId",
  component: ExternalCoordinatorPage,
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

const settingsProject = createRoute({ getParentRoute: () => settingsRoot, path: "/projects/$projectId", component: ProjectSettingsPage });

const settingsAgents = createRoute({
  getParentRoute: () => settingsRoot,
  path: "/agents",
  component: SettingsAgents,
});
const settingsOpenma = createRoute({ getParentRoute: () => settingsRoot, path: "/openma", component: SettingsOpenMA });
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
  projectsRoute,
  projectRoute,
  externalCoordinatorRoute,
  settingsRoot.addChildren([
    settingsProject,
    settingsOpenma,
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
