import { describe, expect, it, vi } from "vitest";

describe("markdown link menu", () => {
  it("offers in-app, external, and copy actions in that order", async () => {
    const module = await import("./MarkdownLinkMenu").catch(() => null);
    const openInApp = vi.fn();
    const openExternal = vi.fn();
    const copy = vi.fn().mockResolvedValue(undefined);

    expect(module).not.toBeNull();
    const actions = module?.markdownLinkMenuActions({
      url: "https://apnews.com/world-news",
      label: "AP World",
      openInApp,
      openExternal,
      copy,
    });

    expect(actions?.map((action) => action.id)).toEqual([
      "open-in-app",
      "open-external",
      "copy",
    ]);
    actions?.[0]?.run();
    actions?.[1]?.run();
    await actions?.[2]?.run();
    expect(openInApp).toHaveBeenCalledWith(
      "https://apnews.com/world-news",
      "AP World",
    );
    expect(openExternal).toHaveBeenCalledWith("https://apnews.com/world-news");
    expect(copy).toHaveBeenCalledWith("https://apnews.com/world-news");
  });
});
