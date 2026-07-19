import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerNotice } from "./ComposerNotice";

describe("ComposerNotice", () => {
  it("renders as a restrained transient status line", () => {
    const html = renderToStaticMarkup(
      <ComposerNotice
        notice={{
          id: "notice-1",
          message: "Skill descriptions were shortened.",
          tone: "warning",
          expiresAt: 10_000,
        }}
        dismissLabel="Dismiss notice"
        onDismiss={() => undefined}
      />,
    );

    expect(html).toContain("Skill descriptions were shortened.");
    expect(html).toContain("line-clamp-2");
    expect(html).not.toContain("lucide-triangle-alert");
    expect(html).not.toContain("bg-warning-subtle");
  });
});
