import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SIDEBAR_NAV_ROW_CLASS,
  sidebarNavRowClass,
  sidebarNavRowStateClass,
} from "./sidebar-nav-row";

const styles = readFileSync(
  resolve(__dirname, "../styles/index.css"),
  "utf8",
);
const sidebar = readFileSync(
  resolve(__dirname, "../components/shell/Sidebar.tsx"),
  "utf8",
);
const settings = readFileSync(
  resolve(__dirname, "../pages/settings/SettingsLayout.tsx"),
  "utf8",
);

describe("sidebar nav row", () => {
  it("leaves row layout to the shared sidebar grid", () => {
    expect(SIDEBAR_NAV_ROW_CLASS).toBe(
      "sidebar-nav-row rounded-md text-ui transition-colors",
    );
  });

  it("uses the session row's selected and hover classes", () => {
    expect(sidebarNavRowStateClass({ active: true })).toBe(
      "app-selected-surface text-fg",
    );
    expect(sidebarNavRowStateClass({ active: true, errored: false })).toBe(
      "app-selected-surface text-fg",
    );
    expect(sidebarNavRowStateClass({ active: true, errored: true })).toBe(
      "app-selected-surface text-fg",
    );
    expect(sidebarNavRowStateClass({ active: false, errored: true })).toBe(
      "text-danger",
    );
    expect(sidebarNavRowStateClass({ active: false })).toBe(
      "text-fg-subtle hover:bg-[var(--control-bg-hover)] hover:text-fg",
    );
    expect(sidebarNavRowStateClass({ active: false, errored: false })).toBe(
      "text-fg-subtle hover:bg-[var(--control-bg-hover)] hover:text-fg",
    );
  });

  it("keeps extra classes without replacing the shared row", () => {
    const idle = sidebarNavRowClass({ active: false });
    expect(idle.startsWith("sidebar-nav-row")).toBe(true);
    expect(idle).toContain("hover:bg-[var(--control-bg-hover)]");
    const back = sidebarNavRowClass({
      active: false,
      className: "app-no-drag mb-2 w-fit",
    });
    expect(back).toContain("w-fit");
    expect(back).not.toContain("w-full");
    expect(back).toContain("app-no-drag");
    const selected = sidebarNavRowClass({ active: true, className: "group relative" });
    expect(selected).toContain("group relative");
    expect(selected).toContain("app-selected-surface");
    expect(selected).toContain(SIDEBAR_NAV_ROW_CLASS.split(" ")[0]);
  });

  it("resolves session and settings rows from one height rule", () => {
    const navigation = styles.slice(styles.indexOf(".sidebar-navigation {"));
    expect(navigation).toMatch(/--sidebar-row-h:\s*28px;/);
    expect(navigation).toMatch(
      /\.sidebar-navigation :is\(button, a\):focus-visible \{[^}]*outline-offset:\s*-2px;/,
    );
    expect(navigation).toMatch(
      /\.sidebar-navigation \.space-y-0\\.5 > :not\(\[hidden\]\) ~ :not\(\[hidden\]\),\s*\.sidebar-navigation \.mt-0\\.5 \{[^}]*margin-top:\s*var\(--sidebar-row-step\);/,
    );
    // Two rounded washes are kept apart by the 2px step, not by trimming paint.
    expect(navigation).toMatch(/--sidebar-row-step:\s*2px;/);
    expect(styles).not.toContain("--sidebar-twin-wash-trim");
    expect(settings).toContain('className="space-y-0.5"');
    expect(styles).toMatch(/\.sidebar-nav-row\s*\{[^}]*height:\s*var\(--sidebar-row-h\);/);
    expect(styles.indexOf("--sidebar-row-h: 28px")).toBe(
      styles.lastIndexOf("--sidebar-row-h: 28px"),
    );

    const session = sidebar.slice(
      sidebar.indexOf("export function SessionRow"),
      sidebar.indexOf("function PairChatLauncher"),
    );
    expect(session).toContain("sidebarNavRowClass(");
    expect(session).not.toContain('style={{ height: "var(--sidebar-row-h)" }}');
    expect(settings).toContain('className="sidebar-navigation ');
    expect(settings).toContain("sidebarNavRowClass({ active })");
    expect(settings).toContain("sidebarNavRowClass({ active: location.pathname");
    expect(settings).not.toContain("hover:bg-bg-surface");
    expect(settings).not.toContain("h-[var(--sidebar-row-h)]");
  });

  it("keeps selected rows on the opaque surface-selected token", () => {
    const hoverRule = styles.slice(
      styles.indexOf(
        '.sidebar-navigation\n  .sidebar-grid-row:not([data-sidebar-row="new-chat"])',
      ),
      styles.indexOf(".sidebar-grid-row[data-sidebar-row=\"new-chat\"]"),
    );
    expect(hoverRule).not.toMatch(/:is\([^)]*\.app-selected-surface/);
    expect(styles).toMatch(
      /\.sidebar-navigation\s+\.sidebar-grid-row\.app-selected-surface\s*\{\s*background:\s*var\(--surface-selected\);/,
    );
    expect(styles).toMatch(/\.sidebar-new-chat-primary/);
    expect(styles).toMatch(
      /\.sidebar-grid-row\[data-sidebar-row="new-chat"\] > \.sidebar-new-chat-primary \{[^}]*grid-template-columns:\s*subgrid;/,
    );
    expect(styles).toMatch(
      /\.sidebar-grid-row\[data-sidebar-row="new-chat"\] \[data-sidebar-grid="trailing"\] \{[^}]*align-self:\s*stretch;/,
    );
    expect(styles).toMatch(
      /\.sidebar-section-header\.sidebar-grid-row \{[^}]*align-items:\s*stretch;/,
    );
    expect(styles).not.toContain(
      '.sidebar-grid-row[data-sidebar-row="new-chat"]::before',
    );
    const newChat = sidebar.slice(
      sidebar.indexOf('data-sidebar-row="new-chat"'),
      sidebar.indexOf("sidebar-scroll-content"),
    );
    const primaryStart = newChat.indexOf("sidebar-new-chat-primary");
    const primaryEnd = newChat.indexOf("</button>", primaryStart);
    const trailing = newChat.indexOf('slot="trailing"');
    expect(primaryStart).toBeGreaterThan(-1);
    expect(newChat.indexOf('slot="icon"')).toBeGreaterThan(primaryStart);
    expect(newChat.indexOf('slot="label"')).toBeGreaterThan(newChat.indexOf('slot="icon"'));
    expect(primaryEnd).toBeGreaterThan(newChat.indexOf('slot="label"'));
    expect(trailing).toBeGreaterThan(primaryEnd);
    expect(styles).toMatch(
      /\.sidebar-navigation \.sidebar-grid-row\.app-selected-surface \{[^}]*--surface-selected/,
    );
  });
});
