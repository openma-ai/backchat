import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/chat/session-1" }),
  useRouter: () => ({
    history: {
      canGoBack: () => false,
      length: 1,
      location: { state: { __TSR_index: 0 } },
      back: vi.fn(),
      forward: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ themeId: "default", effective: "dark" }),
}));

vi.mock("@/themes", () => ({
  getThemePlugin: () => ({ layout: { sidebarWidth: 240 } }),
}));

import {
  AppShell,
  BottomBarCollapseContext,
  RightRailCollapseContext,
  RightRailExpansionContext,
  SidebarCollapseContext,
} from "./AppShell";

function renderExpandedShell(mainSelected = false) {
  return renderToStaticMarkup(
    <SidebarCollapseContext.Provider value={{ collapsed: false, toggle: vi.fn(), set: vi.fn() }}>
      <RightRailCollapseContext.Provider value={{ collapsed: false, toggle: vi.fn(), set: vi.fn() }}>
        <RightRailExpansionContext.Provider
          value={{
            expanded: true,
            mainSelected,
            setExpanded: vi.fn(),
            selectMain: vi.fn(),
            selectPanel: vi.fn(),
          }}
        >
          <BottomBarCollapseContext.Provider value={{ collapsed: true, toggle: vi.fn(), set: vi.fn() }}>
            <AppShell
              sidebar={<div>Sidebar</div>}
              topbar={<div>Task title</div>}
              rightPanel={<div>Changes</div>}
              bottomPanel={<div>Terminal</div>}
            >
              <div>Main session</div>
            </AppShell>
          </BottomBarCollapseContext.Provider>
        </RightRailExpansionContext.Provider>
      </RightRailCollapseContext.Provider>
    </SidebarCollapseContext.Provider>,
  );
}

describe("AppShell expanded right panel", () => {
  it("keeps the resize hit target invisible instead of drawing a full-height hover bar", () => {
    const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

    expect(source).toContain("cursor-ew-resize");
    expect(source).not.toContain("group-hover/rail-resizer:opacity-70");
  });

  it("fills the workspace beside the pinned left navigation", () => {
    const markup = renderExpandedShell();

    expect(markup).toContain('data-right-panel-expanded="true"');
    expect(markup).toContain(
      "width:calc(100% - 240px - var(--stage-inset) * 2)",
    );
    expect(markup).toContain("bottom:var(--stage-inset)");
    expect(markup).toContain("padding-right:var(--stage-inset)");
    expect(markup).toContain(
      'data-expanded-surface="panel" style=',
    );
    const expandedPanelMarkup = markup.slice(
      markup.indexOf('data-right-panel-expanded="true"') - 160,
      markup.indexOf('data-right-panel-expanded="true"') + 320,
    );
    const expandedPanelClass = markup.match(
      /<aside class="([^"]+)" data-right-panel-expanded="true"/,
    )?.[1].split(/\s+/) ?? [];
    expect(expandedPanelClass).toContain("bg-bg-sidebar");
    expect(expandedPanelClass).not.toContain("bg-bg");
    expect(markup).not.toContain('<header class="app-drag-region');
    expect(expandedPanelMarkup).not.toContain("liquid-glass");
    expect(markup).not.toContain('aria-label="Resize side panel"');
    expect(markup).not.toContain('aria-label="Open terminal"');
  });

  it("keeps only the expanded header interactive over the selected main session", () => {
    const markup = renderExpandedShell(true);
    const expandedMainMarkup = markup.slice(
      markup.indexOf('data-expanded-surface="main"'),
      markup.indexOf('data-expanded-surface="main"') + 520,
    );

    expect(expandedMainMarkup).toContain("bottom:auto");
    expect(expandedMainMarkup).toContain("height:var(--top-row-h)");
    expect(expandedMainMarkup).toContain("pointer-events:auto");
    expect(expandedMainMarkup).not.toContain("pointer-events:none");
    expect(markup).not.toContain('<header class="app-drag-region');
  });
});
