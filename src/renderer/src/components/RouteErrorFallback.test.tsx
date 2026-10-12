import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/RendererCrashPage", () => ({
  RendererCrashPage: ({
    message,
  }: {
    message: string;
    stack?: string;
  }) => <div data-route-error-fallback="true">{message}</div>,
}));

import { RouteErrorFallback } from "./RouteErrorFallback";

describe("RouteErrorFallback", () => {
  it("renders RendererCrashPage for route errors", () => {
    const html = renderToStaticMarkup(
      <RouteErrorFallback error={new Error("Route blew up")} reset={() => {}} />,
    );
    expect(html).toContain('data-route-error-fallback="true"');
    expect(html).toContain("Route blew up");
  });
});
