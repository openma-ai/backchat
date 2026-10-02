import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === "session.externalSource") return `External · ${values?.client ?? ""}`;
      if (key === "project.externalCoordinator") return `External coordinator: ${values?.client ?? ""}`;
      return key;
    },
  }),
}));

import { ExternalSourceBadge } from "./ExternalSourceBadge";

describe("external source badge", () => {
  it("names the CLI caller on a session", () => {
    const html = renderToStaticMarkup(
      <ExternalSourceBadge client="cursor killer" />,
    );
    expect(html).toContain('data-testid="external-source-badge"');
    expect(html).toContain("External · cursor killer");
  });

  it("attributes project work to the external coordinator", () => {
    const html = renderToStaticMarkup(
      <ExternalSourceBadge client="cursor killer" variant="coordinator" />,
    );
    expect(html).toContain("External coordinator: cursor killer");
  });
});
