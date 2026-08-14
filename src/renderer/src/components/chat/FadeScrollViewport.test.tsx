import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    isAtBottom: true,
  }),
}));

describe("FadeScrollViewport", () => {
  it("derives fades from the scrollable edges", async () => {
    const module = await import("./FadeScrollViewport").catch(() => null);

    expect(module).not.toBeNull();
    expect(
      module?.scrollFadeState({
        scrollTop: 0,
        scrollHeight: 300,
        clientHeight: 100,
      }),
    ).toEqual({ top: false, bottom: true });
    expect(
      module?.scrollFadeState({
        scrollTop: 100,
        scrollHeight: 300,
        clientHeight: 100,
      }),
    ).toEqual({ top: true, bottom: true });
    expect(
      module?.scrollFadeState({
        scrollTop: 200,
        scrollHeight: 300,
        clientHeight: 100,
      }),
    ).toEqual({ top: true, bottom: false });
    expect(
      module?.scrollFadeState({
        scrollTop: 0,
        scrollHeight: 100,
        clientHeight: 100,
      }),
    ).toEqual({ top: false, bottom: false });
  });

  it("renders fixed fade overlays outside the scrolling content", async () => {
    const module = await import("./FadeScrollViewport").catch(() => null);

    expect(module).not.toBeNull();
    if (!module) return;
    const html = renderToStaticMarkup(
      <module.FadeScrollViewport level="primary">
        <span>Timeline</span>
      </module.FadeScrollViewport>,
    );

    expect(html).toContain('data-fade-scroll-viewport="primary"');
    expect(html).toContain('data-scroll-fade="top"');
    expect(html).toContain('data-scroll-fade="bottom"');
    expect(html).toContain("Timeline");
  });
});
