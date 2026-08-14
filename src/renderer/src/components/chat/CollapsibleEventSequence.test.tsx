import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { CollapsibleEventSequence } from "./CollapsibleEventSequence";

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    isAtBottom: true,
  }),
  useStickToBottomContext: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    stopScroll: vi.fn(),
  }),
}));

describe("CollapsibleEventSequence", () => {
  const nodes = [
    {
      key: "read",
      projection: { summary: "Read files" },
      content: <span>Read files body</span>,
    },
    {
      key: "run",
      projection: { summary: "Run tests" },
      content: <span>Run tests body</span>,
    },
  ];

  it("opens a running event sequence so its timeline is immediately visible", () => {
    const html = renderToStaticMarkup(
      <CollapsibleEventSequence
        nodes={nodes}
        active
        completedProjection={{ summary: "Ran commands" }}
      />,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Read files body");
    expect(html).toContain("Run tests body");
  });

  it("keeps a single atomic event out of an unnecessary second disclosure", () => {
    const html = renderToStaticMarkup(
      <CollapsibleEventSequence
        nodes={[nodes[0]]}
        active={false}
        completedProjection={{ summary: "Read files" }}
      />,
    );

    expect(html).toContain("Read files body");
    expect(html).not.toContain("data-collapsible-event-count");
  });

  it("puts process and event chevrons in the same trailing slot", () => {
    const processHtml = renderToStaticMarkup(
      <Reasoning isStreaming={false} open={false}>
        <ReasoningTrigger getThinkingMessage={() => "Worked for 4s"} />
        <ReasoningContent>Process</ReasoningContent>
      </Reasoning>,
    );
    const eventHtml = renderToStaticMarkup(
      <CollapsibleEventSequence
        nodes={nodes}
        active={false}
        completedProjection={{ summary: "Ran commands" }}
      />,
    );

    expect(processHtml).toContain('data-disclosure-chevron-slot="true"');
    expect(eventHtml).toContain('data-disclosure-chevron-slot="true"');
  });
});
