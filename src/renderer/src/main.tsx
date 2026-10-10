import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeController } from "@/components/ThemeController";
import { AppStartupGate } from "@/components/AppStartupGate";
import { ComposerHarnessLiveAuthWarmup } from "@/components/ComposerHarnessLiveAuthWarmup";
import { RendererErrorBoundary } from "@/components/RendererErrorBoundary";
import { RendererCrashPage } from "@/components/RendererCrashPage";
import { RendererCrashLegacyPreview } from "@/dev/RendererCrashLegacyPreview";
import { installRendererCrashHandlers } from "@/lib/renderer-crash-report";
import { router } from "@/router";
import { applyStoredTheme } from "@/lib/theme";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "@openma/common/chat-ui/styles.css";
import "./styles/index.css";

/**
 * Renderer entry. TanStack Router owns the page layout via routeTree; the
 * QueryClient powers async fetches (agentsList, future SQLite-backed lists).
 *
 * Settings + session-event subscription lives inside ShellLayout, not here —
 * keeps the entry file minimal and lets the layout decide which side-effects
 * it owns.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false },
  },
});

const DEMO_CRASH_MESSAGE =
  "TypeError: Cannot read properties of undefined (reading 'map')";
const DEMO_CRASH_STACK = `TypeError: Cannot read properties of undefined (reading 'map')
    at ChatTurnList (ChatView.tsx:412:18)
    at renderWithHooks (react-dom.development.js:15486:18)`;
const DEMO_CRASH_COMPONENT_STACK = `
    at ChatTurnList (http://localhost:5173/src/components/chat/ChatView.tsx:88:5)
    at ShellLayout (http://localhost:5173/src/components/shell/ShellLayout.tsx:44:11)`;

// Apply the cached selection before React paints. ThemeController reconciles
// it with ~/.oma/config.toml as soon as settings arrive over IPC.
applyStoredTheme();
installRendererCrashHandlers();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

const crashDemoParams = new URLSearchParams(window.location.search);
const rendererCrashDemo = crashDemoParams.get("demo") === "renderer-crash";

if (rendererCrashDemo) {
  const legacy = crashDemoParams.get("variant") === "legacy";
  const CrashSurface = legacy ? RendererCrashLegacyPreview : RendererCrashPage;
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeController />
        <CrashSurface
          message={DEMO_CRASH_MESSAGE}
          stack={DEMO_CRASH_STACK}
          componentStack={DEMO_CRASH_COMPONENT_STACK}
        />
      </QueryClientProvider>
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RendererErrorBoundary>
          <TooltipProvider>
            <ThemeController />
            <AppStartupGate>
              <ComposerHarnessLiveAuthWarmup />
              <RouterProvider router={router} />
            </AppStartupGate>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </RendererErrorBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );
}
