import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactionActivity } from "./CompactionActivity";

describe("standard ACP compaction activity", () => {
  it.each(["in_progress", "completed", "failed", "cancelled", "_future"])("renders %s without inventing thoughts or tools", (status) => {
    const html = renderToStaticMarkup(<CompactionActivity compaction={{ id: "c", status, summary: [{ type: "text", text: "Retained facts" }], error: status === "failed" ? "Compact failed" : undefined }} />);
    expect(html).toContain(`data-compaction-status="${status}"`);
    expect(html).toContain("Retained facts");
    expect(html).not.toContain("data-tool-call-id");
    if (status === "in_progress") expect(html).toContain("shimmer-text");
    else expect(html).not.toContain("shimmer-text");
    if (status === "failed") expect(html).toContain("Compact failed");
  });
  it("does not offer an empty summary disclosure", () => {
    const html = renderToStaticMarkup(<CompactionActivity compaction={{ id: "c", status: "completed" }} />);
    expect(html).not.toContain("<details");
    expect(html).toContain("Context compacted");
  });
});
