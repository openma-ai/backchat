import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
  }) => <button disabled={disabled}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

import { BrowserMenu } from "./BrowserMenu";

describe("BrowserMenu", () => {
  it("renders the complete browser action surface with current zoom state", () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(
      <BrowserMenu
        zoomFactor={1.25}
        canOpenExternal={false}
        onOpenFind={noop}
        onPrintPage={noop}
        onChangeZoom={noop}
        onResetZoom={noop}
        onShowDeviceToolbar={noop}
        onCaptureScreenshot={noop}
        onReload={noop}
        onCopyAddress={noop}
        onOpenExternal={noop}
        onOpenPanel={noop}
        onOpenSettings={noop}
      />,
    );

    expect(markup).toContain('aria-label="Browser menu"');
    expect(markup).toContain("Find in page");
    expect(markup).toContain("Print");
    expect(markup).toContain("125%");
    expect(markup).toContain("Show device toolbar");
    expect(markup).toContain("Capture screenshot");
    expect(markup).toContain("Import cookies and passwords…");
    expect(markup).toContain("Passwords and autofill");
    expect(markup).toContain("Downloads");
    expect(markup).toContain("Clear browsing data");
    expect(markup).toContain("Browser settings");
    expect(markup).toMatch(/<button disabled="">[\s\S]*Open in default browser/);
  });
});
