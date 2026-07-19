import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownAnchor, MarkdownCwdProvider } from "./ChatMarkdown";

describe("MarkdownAnchor", () => {
  it("renders a relative file link when the surrounding session has a cwd", () => {
    const html = renderToStaticMarkup(
      <MarkdownCwdProvider cwd="/workspace/project">
        <MarkdownAnchor href="docs/report.md">Report</MarkdownAnchor>
      </MarkdownCwdProvider>,
    );

    expect(html).toContain('<a href="docs/report.md"');
    expect(html).toContain(">Report</a>");
  });

  it("keeps a relative path inert when there is no cwd to resolve it against", () => {
    const html = renderToStaticMarkup(
      <MarkdownCwdProvider cwd={null}>
        <MarkdownAnchor href="docs/report.md">Report</MarkdownAnchor>
      </MarkdownCwdProvider>,
    );

    expect(html).toContain("<span");
    expect(html).toContain(">Report</span>");
    expect(html).not.toContain("<a");
  });
});
