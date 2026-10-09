import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string) =>
      ({
        "crash.title": "Something went wrong",
        "crash.description": "The interface hit an unexpected error.",
        "crash.details": "Error details",
        "crash.reload": "Reload",
        "crash.copy": "Copy error info",
        "crash.copied": "Copied",
        "crash.copyFailed": "Couldn't copy",
      })[key] ?? key,
  }),
}));

import { RendererCrashPage } from "./RendererCrashPage";

describe("RendererCrashPage", () => {
  it("renders home empty-state typography, drag region, and localized actions", () => {
    const html = renderToStaticMarkup(
      <RendererCrashPage
        message="Test boom"
        stack="Error: Test boom\n    at App"
        componentStack="\n    in RouterProvider"
      />,
    );

    expect(html).toContain('data-renderer-crash-page="true"');
    expect(html).toContain('data-backchat-crash-mark="true"');
    expect(html).not.toContain("brand-loader-dot");
    expect(html).not.toMatch(/>\[</);
    expect(html).toContain("app-canvas-surface");
    expect(html).toContain("app-drag-region");
    expect(html).toContain("home-empty-intro");
    expect(html).toContain("home-hero-title");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Error details");
    expect(html).toContain("Reload");
    expect(html).toContain("Copy error info");
    expect(html).toContain('data-slot="collapsible"');
  });
});
