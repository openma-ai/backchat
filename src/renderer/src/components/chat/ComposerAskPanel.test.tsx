import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InlineAskPanel } from "./ComposerAskPanel";

describe("InlineAskPanel", () => {
  it("does not dismiss the callback when Escape only closes a nested menu", () => {
    const source = readFileSync(new URL("./ComposerAskPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("hasOpenComposerTransientSurface()");
  });

  it("uses the same tool identity and input language as a normal bash run", () => {
    const html = renderToStaticMarkup(
      <InlineAskPanel
        ask={{
          kind: "permission",
          ask: {
            requestId: "permission-polish-1",
            sessionId: "session-1",
            toolCall: { title: "bash" },
            presentation: {
              title: "bash",
              kind: "execute",
              command: "printf 'OK' > result.txt && cat result.txt",
            },
            options: [
              { optionId: "once", name: "Allow once", kind: "allow_once" },
              { optionId: "always", name: "Always allow", kind: "allow_always" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          },
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain('data-permission-primary-action="true"');
    expect(html).toContain('data-permission-reject-action="true"');
    expect(html).toContain('data-codex-approval-actions="true"');
    expect(html).toContain('data-variant="outline"');
    expect(html).toContain('aria-label="More approval options"');
    expect(html).toContain("Approval required");
    expect(html).toContain('data-tool-activity-identity="execute"');
    expect(html).toContain('data-tool-input="permission-polish-1"');
    expect(html).not.toContain("tracking-[0.08em]");
    expect(html).not.toContain("border-primary-foreground");
  });

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

  it("renders a single-choice elicitation as Codex-style full-row choices", () => {
    const html = renderToStaticMarkup(
      <InlineAskPanel
        ask={{
          kind: "elicitation",
          ask: {
            requestId: "elicit-choice-1",
            sessionId: "session-1",
            message: "What should we do next?",
            fields: [{
              name: "direction",
              type: "select",
              title: "Direction",
              required: true,
              options: [
                { value: "build", label: "Build the API" },
                { value: "audit", label: "Audit a site" },
                { value: "polish", label: "Polish the skill" },
              ],
            }],
          },
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain('data-elicitation-form="choice"');
    expect(html).toContain('data-elicitation-choice="build"');
    expect(html).toContain('data-elicitation-choice="audit"');
    expect(html).toContain('data-elicitation-choice="polish"');
    expect(html).toContain("Skip");
    expect(html).not.toContain("Input required");
  });

  it("keeps Codex oneOf choices inline when the adapter adds an optional other field", () => {
    const html = renderToStaticMarkup(
      <InlineAskPanel
        ask={{
          kind: "elicitation",
          ask: {
            requestId: "elicit-choice-other-1",
            sessionId: "session-1",
            message: "Which direction should we validate next?",
            fields: [
              {
                name: "validation_direction",
                type: "select",
                title: "Validation direction",
                description: "Which direction should we validate next?",
                required: false,
                options: [
                  { value: "Permission", label: "Permission" },
                  { value: "Subagents", label: "Subagents" },
                  { value: "Sessions", label: "Sessions" },
                ],
              },
              {
                name: "validation_direction__other",
                type: "text",
                title: "Other",
                description: "Type your own answer instead of choosing an option above.",
                required: false,
              },
            ],
          },
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain('data-elicitation-form="choice"');
    expect(html).toContain('data-elicitation-choice="Permission"');
    expect(html).toContain('data-elicitation-choice="Subagents"');
    expect(html).toContain('data-elicitation-choice="Sessions"');
    expect(html).toContain('data-elicitation-other="validation_direction__other"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('>Submit<');
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
