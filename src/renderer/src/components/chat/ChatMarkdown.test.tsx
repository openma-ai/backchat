import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MarkdownAnchor,
  MarkdownCwdProvider,
  StreamdownText,
} from "./ChatMarkdown";

describe("StreamdownText", () => {
  it("preserves plain arithmetic in completed thought text", () => {
    const html = renderToStaticMarkup(
      <StreamdownText
        text={'The user is asking me to calculate 37 + 58.\n\n37 + 58 = 95.'}
        cwd={null}
        sessionId="session-arithmetic"
        surfacePrefix="thought-arithmetic"
      />,
    );

    expect(html).toContain("37 + 58 = 95.");
  });
});

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
