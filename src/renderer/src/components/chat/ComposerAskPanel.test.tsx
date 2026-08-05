import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InlineAskPanel } from "./ComposerAskPanel";

describe("InlineAskPanel", () => {
  it("renders ACP elicitation in the existing composer ask slot", () => {
    const html = renderToStaticMarkup(
      <InlineAskPanel
        ask={{
          kind: "elicitation",
          ask: {
            requestId: "elicit-inline-1",
            sessionId: "session-1",
            message: "Configure release",
            fields: [
              {
                name: "note",
                type: "text",
                title: "Release note",
                required: true,
              },
              {
                name: "retries",
                type: "number",
                title: "Retries",
                required: true,
                integer: true,
                minimum: 0,
                maximum: 5,
              },
            ],
          },
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain("Configure release");
    expect(html).toContain('name="note"');
    expect(html).toContain('name="retries"');
    expect(html).toContain('type="number"');
    expect(html).toContain("Submit");
    expect(html).toContain("Decline");
    expect(html).not.toContain("Write outside workspace?");
  });

  it("renders URL elicitation consent in the same composer ask slot", () => {
    const html = renderToStaticMarkup(
      <InlineAskPanel
        ask={{
          kind: "elicitation",
          ask: {
            requestId: "elicit-url-inline-1",
            sessionId: "session-1",
            mode: "url",
            message: "Authorize repository access",
            elicitationId: "github-oauth-001",
            url: "https://agent.example.com/connect?elicitationId=github-oauth-001",
          },
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain("Authorize repository access");
    expect(html).toContain(
      "https://agent.example.com/connect?elicitationId=github-oauth-001",
    );
    expect(html).toContain("Open agent.example.com");
    expect(html).toContain("Decline");
    expect(html).not.toContain("Submit");
  });
});
