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
  } & Record<string, unknown>) => <div className={className} {...props}>{children}</div>,
}));

import { ComposerSearchableSelectMenu } from "./ComposerSearchableSelectMenu";

describe("ComposerSearchableSelectMenu", () => {
  it("renders grouped rows and a search field for long lists", () => {
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
    expect(html).toContain('type="search"');
    expect(html).toContain("anthropic-proxy");
    expect(html).toContain('data-composer-select-active="true"');
    expect(html).toContain("oma-scrollbar");
    expect(html).toContain("max-h-[min(420px");
  });
});
