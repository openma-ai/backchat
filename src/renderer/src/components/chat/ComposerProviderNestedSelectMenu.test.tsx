import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
  } & Record<string, unknown>) => <div {...props}>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ComposerProviderNestedSelectMenu } from "./ComposerProviderNestedSelectMenu";

describe("ComposerProviderNestedSelectMenu", () => {
  it("renders provider submenu triggers for large multi-provider lists", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      value: `model-${index}`,
      label: `Model ${index}`,
      groupName: index % 2 === 0 ? "anthropic-proxy" : "openai-codex",
    }));
    const html = renderToStaticMarkup(
      <ComposerProviderNestedSelectMenu
        items={items}
        activeValue="model-3"
        onSelect={() => {}}
        searchPlaceholder="Search"
        emptyMessage="None"
        providerIcon={<span>icon</span>}
        renderItem={(item) => <span>{item.label}</span>}
      />,
    );
    expect(html).toContain('data-composer-provider-sub="true"');
    expect(html).toContain("anthropic-proxy");
    expect(html).toContain("openai-codex");
  });
});
