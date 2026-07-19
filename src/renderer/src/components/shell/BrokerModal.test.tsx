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
});
