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

describe("a permission card always says what it is asking", () => {
  it("falls back to a sentence when the agent sends neither reason nor command", () => {
    // The body used to be gated on reason || command, which excluded the very
    // fallback written for their absence: a Terminal permission with neither
    // rendered a tool name, two buttons, and nothing to judge.
    const html = renderToStaticMarkup(
      <InlineAskPanel
        ask={{
          kind: "permission",
          ask: {
            requestId: "permission-bare-1",
            sessionId: "session-1",
            toolCall: { title: "Terminal" },
            presentation: { title: "Terminal", kind: "execute" },
            options: [
              { optionId: "once", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Decline", kind: "reject_once" },
            ],
          },
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain("Allow this action?");
  });
});

describe("permission copy stays readable", () => {
  const codexGenericAsk = (command: string) => ({
    kind: "permission" as const,
    ask: {
      requestId: "permission-generic-1",
      sessionId: "session-1",
      toolCall: { title: "Approve this action?" },
      presentation: {
        // Codex sends a generic question here, not a tool name.
        title: "Approve this action?",
        kind: "execute",
        command,
      },
      options: [
        { optionId: "once", name: "Allow Once", kind: "allow_once" as const },
        { optionId: "session", name: "Allow for Session", kind: "allow_always" as const },
        {
          optionId: "prefix",
          // Codex's real option name: long, and rendered verbatim per ACP.
          name: "Allow Commands Starting With `AGENT_BROWSER_SOCKET_DIR=/tmp/ab-wen4 agent-browser read`",
          kind: "allow_always" as const,
        },
        { optionId: "reject", name: "Reject", kind: "reject_once" as const },
      ],
    },
  });

  it("never splices the agent's question into a phrase", () => {
    const html = renderToStaticMarkup(
      <InlineAskPanel ask={codexGenericAsk("ls -la")} onResolve={vi.fn()} />,
    );

    // The shipped bug read "Allow Approve this action? to run this action?".
    expect(html).not.toContain("to run this action?");
    expect(html).not.toContain("Allow Approve this action?");
    expect(html).toContain("Allow this action?");
  });

  it("does not use a question as the tool target label", () => {
    const html = renderToStaticMarkup(
      <InlineAskPanel ask={codexGenericAsk("ls -la")} onResolve={vi.fn()} />,
    );

    expect(html).toContain('data-tool-activity-identity="execute"');
    expect(html).not.toContain("Approve this action?");
  });

  it("keeps a long agent option name verbatim inside a bounded menu", () => {
    const source = readFileSync(new URL("./ComposerAskPanel.tsx", import.meta.url), "utf8");
    const menu = source.slice(source.indexOf("<DropdownMenuContent"));
    const props = menu.slice(0, menu.indexOf(">"));

    // A fixed w-52 clipped and overlapped Codex's long option names, but a
    // fixed 26rem was just as wrong in the other direction: the menu opens
    // upward over the command being approved, so one short option must not
    // reserve a wide empty slab. Bound the ceiling, let the width hug.
    expect(props).not.toContain("w-52");
    expect(props).toContain("max-w-[min(26rem,80vw)]");
    expect(props).toContain("w-auto");
    expect(props).not.toMatch(/className="[^"]*(?<!max-)w-\[min\(26rem,80vw\)\]/);
    expect(menu).toContain("whitespace-normal break-words");
    expect(source).toContain("{option.name}");
  });

  it("routes every ask string through the translator", () => {
    const source = readFileSync(new URL("./ComposerAskPanel.tsx", import.meta.url), "utf8");

    for (const literal of [
      '"Approval required"',
      '"Confirmation required"',
      '"Filesystem approval"',
      '"Write outside workspace?"',
      '"More approval options"',
      '"Dismiss"',
    ]) {
      expect(source).not.toContain(literal);
    }
    expect(source).toContain('t("permission.approvalRequired")');
    expect(source).toContain('t("permission.allowThisAction")');
    expect(source).toContain('t("ask.dismiss")');
  });
});
