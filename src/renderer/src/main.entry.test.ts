import { describe, expect, it, vi } from "vitest";

const dataset: { os?: string } = {};
const render = vi.fn();

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render }),
}));
vi.mock("@/router", () => ({ router: { subscribe() { return () => undefined; } } }));
vi.mock("@/lib/theme", () => ({ applyStoredTheme: () => undefined }));
vi.mock("@/components/ThemeController", () => ({ ThemeController: () => null }));
vi.mock("@/components/AppStartupGate", () => ({
  AppStartupGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@tanstack/react-router", () => ({
  RouterProvider: () => null,
}));

describe("renderer entry", () => {
  it("tags the document with the OS before the first paint", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    });
    vi.stubGlobal("document", {
      documentElement: { dataset },
      getElementById: () => ({ nodeType: 1 }),
    });
    await import("./main");
    expect(dataset.os).toBe("mac");
    expect(render).toHaveBeenCalled();
  });
});
