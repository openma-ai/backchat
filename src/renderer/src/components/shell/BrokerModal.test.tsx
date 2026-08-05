import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { ApprovalPrompt } from "./BrokerModal";

describe("ApprovalPrompt", () => {
  it("renders a blocking permission choice instead of transcript activity", () => {
    const html = renderToStaticMarkup(
      <ApprovalPrompt
        ask={{
          kind: "permission",
          ask: {
            requestId: "permission-1",
            sessionId: "session-1",
            toolCall: {
              title: "Run LibreOffice",
              kind: "execute",
              rawInput: {
                command: "libreoffice --headless document.docx",
              },
            },
            presentation: {
              title: "Run LibreOffice",
              kind: "execute",
              command: "libreoffice --headless document.docx",
            },
            options: [
              {
                optionId: "allow-once",
                name: "Allow once",
                kind: "allow_once",
              },
              {
                optionId: "reject",
                name: "Reject",
                kind: "reject_once",
              },
            ],
          },
        }}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain("Run LibreOffice");
    expect(html).toContain("libreoffice --headless document.docx");
    expect(html).toContain("Allow once");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Permission request");
  });

  it("renders only the harness-neutral permission presentation", () => {
    const html = renderToStaticMarkup(
      <ApprovalPrompt
        ask={{
          kind: "permission",
          ask: {
            requestId: "permission-canonical",
            sessionId: "session-1",
            presentation: {
              title: "Canonical title",
              reason: "Canonical reason",
              command: "pnpm verify",
              kind: "execute",
            },
            toolCall: {
              title: "Raw title must not render",
              _meta: {
                codex: {
                  params: {
                    title: "Vendor title must not render",
                    reason: "Vendor reason must not render",
                    command: "rm -rf vendor-value",
                  },
                },
              },
            },
            options: [{
              optionId: "allow-once",
              name: "Allow once",
              kind: "allow_once",
            }],
          },
        } as never}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain("Canonical title");
    expect(html).toContain("Canonical reason");
    expect(html).toContain("pnpm verify");
    expect(html).not.toContain("Raw title must not render");
    expect(html).not.toContain("Vendor title must not render");
    expect(html).not.toContain("Vendor reason must not render");
    expect(html).not.toContain("rm -rf vendor-value");
  });

  it("renders ACP free-text and number elicitation fields in the existing ask sheet", () => {
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(
        <ApprovalPrompt
          ask={{
            kind: "elicitation",
            ask: {
              requestId: "elicit-1",
              sessionId: "session-1",
              message: "Configure release",
              fields: [
                {
                  name: "note",
                  type: "text",
                  title: "Release note",
                  description: "Shown to users",
                  required: true,
                  minLength: 3,
                  maxLength: 120,
                  defaultValue: "Ship it",
                },
                {
                  name: "retries",
                  type: "number",
                  title: "Retries",
                  required: true,
                  integer: true,
                  minimum: 0,
                  maximum: 5,
                  defaultValue: 2,
                },
              ],
            },
          }}
          onResolve={vi.fn()}
        />,
      );
    }).not.toThrow();

    expect(html).toContain("Configure release");
    expect(html).toContain("Release note");
    expect(html).toContain("Shown to users");
    expect(html).toContain('name="note"');
    expect(html).toContain('minLength="3"');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain('name="retries"');
    expect(html).toContain('type="number"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="5"');
    expect(html).toContain('step="1"');
    expect(html).toContain("Submit");
    expect(html).toContain("Decline");
  });

  it("shows the full target and consent actions for ACP URL elicitation", () => {
    const html = renderToStaticMarkup(
      <ApprovalPrompt
        ask={{
          kind: "elicitation",
          ask: {
            requestId: "elicit-url-1",
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
