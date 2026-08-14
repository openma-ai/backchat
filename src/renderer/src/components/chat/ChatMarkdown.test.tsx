import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MARKDOWN_BLOCK_RHYTHM,
  MarkdownAnchor,
  MarkdownCwdProvider,
  StreamdownText,
} from "./ChatMarkdown";

describe("StreamdownText", () => {
  it("scopes hover styling to the individual link", () => {
    expect(MARKDOWN_BLOCK_RHYTHM).toContain("[&_a:hover]:text-fg-muted");
    expect(MARKDOWN_BLOCK_RHYTHM).toContain(
      "[&_a[data-markdown-http-link]:hover]:text-info/80",
    );
    expect(MARKDOWN_BLOCK_RHYTHM).not.toContain("hover:[&_a]");
  });

  it("preserves plain arithmetic in completed thought text", () => {
    const html = renderToStaticMarkup(
      <StreamdownText
        text={"The user is asking me to calculate 37 + 58.\n\n37 + 58 = 95."}
        cwd={null}
        sessionId="session-arithmetic"
        surfacePrefix="thought-arithmetic"
      />,
    );

    expect(html).toContain("37 + 58 = 95.");
  });
});

describe("MarkdownAnchor", () => {
  it("renders an http link with its site favicon and link treatment", () => {
    const html = renderToStaticMarkup(
      <MarkdownCwdProvider cwd={null}>
        <MarkdownAnchor href="https://apnews.com/world-news">
          AP World
        </MarkdownAnchor>
      </MarkdownCwdProvider>,
    );

    expect(html).toContain('data-markdown-http-link="true"');
    expect(html).toContain('src="https://apnews.com/favicon.ico"');
    expect(html).toContain('data-markdown-link-favicon="true"');
    expect(html).toContain("text-info");
  });

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
