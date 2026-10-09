import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RendererErrorFallback } from "./RendererErrorFallback";

describe("RendererErrorFallback", () => {
  it("renders a themed, titlebar-aware fallback with reload and copy actions", () => {
    const html = renderToStaticMarkup(
      <RendererErrorFallback
        message="Test boom"
        stack="Error: Test boom\n    at App"
        componentStack="\n    in RouterProvider"
      />,
    );

    expect(html).toContain('data-renderer-error-fallback="true"');
    expect(html).toContain("app-canvas-surface");
    expect(html).toContain("app-drag-region");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Test boom");
    expect(html).toContain("Reload");
    expect(html).toContain("Copy details");
    expect(html).toContain("text-fg");
  });
});
