import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BackchatCrashMark } from "./BackchatCrashMark";

describe("BackchatCrashMark", () => {
  it("uses the horse-head logo with a center ×, not bracket loader dots", () => {
    const html = renderToStaticMarkup(<BackchatCrashMark />);

    expect(html).toContain('data-backchat-crash-mark="true"');
    expect(html).toContain('viewBox="240 244 548 454"');
    expect(html).toContain('transform="rotate(45)"');
    expect(html).not.toContain('cx="465"');
    expect(html).not.toContain('cx="605"');
    expect(html).not.toContain("brand-loader-dot");
    expect(html).not.toMatch(/>\[</);
  });
});
