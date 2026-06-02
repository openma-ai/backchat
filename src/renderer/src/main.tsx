import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { router } from "@/router";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
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

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
