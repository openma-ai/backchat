import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

import { FileOpenMenu } from "./FileOpenMenu";

describe("FileOpenMenu", () => {
  it("keeps the native open and reveal actions beside an in-app preview", () => {
    const markup = renderToStaticMarkup(
      <FileOpenMenu
        path="/tmp/未命名文档.docx"
        onOpenDefault={vi.fn()}
        onReveal={vi.fn()}
      />,
    );

    expect(markup).toContain("Open in");
    expect(markup).toContain("Default app");
    expect(markup).toContain("Show in Finder");
  });
});
