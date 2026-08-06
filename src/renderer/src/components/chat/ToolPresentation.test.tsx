import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    stopScroll: vi.fn(),
  }),
}));

import {
  ToolContentRenderer,
  ToolRow,
  ToolRawOutputBody,
} from "./ToolPresentation";

describe("ToolRow acceptance contract", () => {
  it.each([
    ["pending", "started", "Started"],
    ["in_progress", "progress", "In progress"],
    ["completed", "completed", "Completed"],
    ["failed", "failed", "Failed"],
    ["cancelled", "cancelled", "Cancelled"],
  ] as const)(
    "exposes a stable id and visible %s lifecycle status",
    (status, lifecycle, label) => {
      const html = renderToStaticMarkup(
        <ToolRow
          sessionId="session-tool-status"
          tool={{
            toolCallId: `tool-${lifecycle}`,
            title: "Run acceptance check",
            kind: "execute",
            status,
          }}
        />,
      );

      expect(html).toContain(`data-tool-call-id="tool-${lifecycle}"`);
      expect(html).toContain(`data-tool-status="${lifecycle}"`);
      expect(html).toContain(`data-tool-status-label="${lifecycle}"`);
      expect(html).toContain(`>${label}<`);
    },
  );

  it("keeps the tool input visibly attributable to the started tool row", () => {
    const html = renderToStaticMarkup(
      <ToolRow
        sessionId="session-tool-input"
        tool={{
          toolCallId: "tool-input-1",
          title: "Search files",
          kind: "search",
          status: "pending",
          rawInput: { query: "runtime vendor event" },
        }}
      />,
    );

    expect(html).toContain('data-tool-input="tool-input-1"');
    expect(html).toContain("runtime vendor event");
  });
});

describe("ToolRawOutputBody", () => {
  it("shows command output without leaking receipt metadata", () => {
    const html = renderToStaticMarkup(
      <ToolRawOutputBody
        rawOutput={{
          call_id: "private-call-id",
          stdout: "generated output",
          stderr: "warning output",
          exit_code: 2,
        }}
      />,
    );

    expect(html).toContain("exit 2");
    expect(html).toContain("generated output");
    expect(html).toContain("warning output");
    expect(html).not.toContain("private-call-id");
  });

  it("falls back to readable JSON for unknown output shapes", () => {
    const html = renderToStaticMarkup(
      <ToolRawOutputBody rawOutput={{ result: "unstructured output" }} />,
    );

    expect(html).toContain('data-tool-output-body="true"');
    expect(html).toContain("result");
    expect(html).toContain("unstructured output");
  });
});

describe("ToolContentRenderer", () => {
  it("renders old and new diff lines with their file path", () => {
    const html = renderToStaticMarkup(
      <ToolContentRenderer
        block={{
          type: "diff",
          path: "src/example.ts",
          oldText: "const answer = 41;",
          newText: "const answer = 42;",
        }}
      />,
    );

    expect(html).toContain("src/example.ts");
    expect(html).toContain("const answer = 41;");
    expect(html).toContain("const answer = 42;");
    expect(html).toContain("bg-danger-subtle");
    expect(html).toContain("bg-success-subtle");
  });

  it("renders terminal and text content without wrapping them in links", () => {
    const terminal = renderToStaticMarkup(
      <ToolContentRenderer block={{ type: "terminal", terminalId: "term-7" }} />,
    );
    const text = renderToStaticMarkup(
      <ToolContentRenderer
        block={{ type: "content", content: { type: "text", text: "tool result" } }}
      />,
    );

    expect(terminal).toContain("terminal term-7");
    expect(terminal).toContain('data-tool-terminal-id="term-7"');
    expect(text).toContain("tool result");
    expect(`${terminal}${text}`).not.toContain("<a");
  });
});
