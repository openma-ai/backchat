import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuItem: ({
    children,
    className,
    ...props
  }: {
    children: React.ReactNode;
    className?: string;
  } & Record<string, unknown>) => (
    <div className={className} {...props}>{children}</div>
  ),
}));

import { ComposerSearchableSelectMenu } from "./searchable-select-menu-adapter";

describe("ComposerSearchableSelectMenu", () => {
  it("renders search and scroll for grouped lists", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      value: `model-${index}`,
      label: `Model ${index}`,
      groupName: index % 2 === 0 ? "anthropic-proxy" : "openai-codex",
    }));
    const html = renderToStaticMarkup(
      <ComposerSearchableSelectMenu
        items={items}
        activeValue="model-3"
        onSelect={() => {}}
        searchPlaceholder="Search models"
        emptyMessage="No matches"
      />,
    );
    expect(html).toContain('cmdk-input=""');
    expect(html).toContain('data-slot="command-list"');
    expect(html).toContain('data-slot="command-group"');
    expect(html).toContain("anthropic-proxy");
    expect(html).toContain("Model 0");
  });

  it("renders a flat list for small menus", () => {
    const html = renderToStaticMarkup(
      <ComposerSearchableSelectMenu
        items={[
          { value: "a", label: "Alpha", groupName: "devin" },
          { value: "b", label: "Beta", groupName: "devin" },
        ]}
        activeValue="a"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("Alpha");
  });

  it("renders provider command groups for large multi-provider lists", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      value: `model-${index}`,
      label: `Model ${index}`,
      groupName: index % 2 === 0 ? "anthropic-proxy" : "openai-codex",
    }));
    const html = renderToStaticMarkup(
      <ComposerSearchableSelectMenu
        items={items}
        activeValue="model-3"
        onSelect={() => {}}
        searchPlaceholder="Search"
        emptyMessage="None"
      />,
    );
    expect(html).toContain("anthropic-proxy");
    expect(html).toContain("openai-codex");
  });
});
