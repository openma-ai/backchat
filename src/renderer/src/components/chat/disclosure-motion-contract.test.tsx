import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    stopScroll: vi.fn(),
  }),
}));

import { AnimatedCollapse } from "@/components/ui/animated-collapse";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { PlanDocumentActivity } from "./PlanDocumentActivity";
import { TaskListActivity } from "./TaskListActivity";
import { ToolRow } from "./ToolPresentation";

/** Every disclosure in the app opens and closes on one motion: the sidebar's
 *  intrinsic-height collapse (grid 0fr → 1fr, fade, 2px settle) on the shared
 *  --motion-disclosure-* tokens. A body that mounts on open, or toggles the
 *  `hidden` attribute, snaps instead of moving with the sidebar. */
describe("chat disclosures share the sidebar's collapse motion", () => {
  const closedShell = /data-slot="animated-collapse" data-state="closed"/;

  it("keeps the tool body in a closed collapse shell", () => {
    const html = renderToStaticMarkup(
      <ToolRow
        sessionId="s"
        tool={{ toolCallId: "t", title: "Search", kind: "search", status: "completed", rawInput: { q: "x" } }}
      />,
    );
    expect(html).toMatch(closedShell);
  });

  it("keeps the task list in a closed collapse shell, not a hidden list", () => {
    const html = renderToStaticMarkup(
      <TaskListActivity items={[{ label: "Ship", status: "in_progress" }]} />,
    );
    expect(html).toMatch(closedShell);
    expect(html).not.toMatch(/<ul[^>]*hidden/);
  });

  it("keeps the plan document in a closed collapse shell", () => {
    const html = renderToStaticMarkup(
      <PlanDocumentActivity
        document={{ id: "p", title: "Plan", markdown: "# Plan" } as never}
        cwd={null}
        sessionId="s"
      />,
    );
    expect(html).toMatch(closedShell);
  });

  it("defers a lazy body until first open while the shell is already in place", () => {
    const html = renderToStaticMarkup(
      <AnimatedCollapse open={false} lazy>
        <span data-heavy-body="true" />
      </AnimatedCollapse>,
    );
    expect(html).toMatch(closedShell);
    expect(html).not.toContain("data-heavy-body");
  });

  it("turns chevrons on the disclosure tokens, like the sidebar caret", () => {
    const html = renderToStaticMarkup(<DisclosureChevron open />);
    expect(html).toContain("duration-[var(--motion-disclosure-duration)]");
    expect(html).toContain("ease-[var(--motion-disclosure-easing)]");
    for (const file of ["PlanDocumentActivity.tsx", "TaskListActivity.tsx"]) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source).toContain("<DisclosureChevron");
    }
  });
});
