import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GroupedCommandMenu,
  groupedCommandMenuPanelClassName,
  groupedCommandMenuPanelMaxHeightStyle,
} from "./grouped-command-menu";

describe("groupedCommandMenuPanelClassName", () => {
  it("caps height without forcing a minimum panel height", () => {
    const className = groupedCommandMenuPanelClassName({ maxHeightPx: 334 });
    expect(className).toContain("h-auto");
    expect(className).toContain("max-h-[min(334px");
    expect(className).not.toContain("min-h-[");
  });
});

describe("groupedCommandMenuPanelMaxHeightStyle", () => {
  it("uses dropdown available height by default", () => {
    expect(groupedCommandMenuPanelMaxHeightStyle({ maxHeightPx: 420 })).toEqual({
      maxHeight:
        "min(420px, var(--radix-dropdown-menu-content-available-height))",
    });
  });

  it("caps popover pickers against popover available height", () => {
    expect(
      groupedCommandMenuPanelMaxHeightStyle({
        maxHeightPx: 336,
        availableHeightVariable: "radix-popover-content-available-height",
      }),
    ).toEqual({
      maxHeight: "min(336px, var(--radix-popover-content-available-height))",
    });
  });
});

describe("grouped command menu styles", () => {
  it("uses shared menu items and separators across grouped layouts", () => {
    const item = (id: string) => ({
      id,
      value: id,
      onSelect: () => undefined,
      children: createElement("span", null, id),
    });
    const hostPicker = renderToStaticMarkup(
      createElement(GroupedCommandMenu, {
        groups: [
          { items: [item("host-first")] },
          { separatorBefore: true, items: [item("host-second")] },
          { heading: "Runtimes", separatorBefore: true, items: [item("host-third")] },
          { heading: "More runtimes", items: [item("host-fourth")] },
        ],
        searchPlaceholder: "",
        emptyMessage: "No results",
        menuMode: "host-picker",
        showSearch: false,
        nativeListScroll: true,
        listHeader: createElement("div", null, "Header"),
      }),
    );
    const grouped = renderToStaticMarkup(
      createElement(GroupedCommandMenu, {
        groups: [
          { items: [item("group-first")] },
          { separatorBefore: true, items: [item("group-second")] },
          { heading: "Models", separatorBefore: true, items: [item("group-third")] },
        ],
        searchPlaceholder: "Search",
        emptyMessage: "No results",
        listHeader: createElement("div", null, "Header"),
        listHeaderSeparator: false,
      }),
    );
    const projectPicker = renderToStaticMarkup(
      createElement(GroupedCommandMenu, {
        groups: [{ items: [item("project")] }],
        searchPlaceholder: "Search projects",
        emptyMessage: "No projects",
        menuMode: "project-picker",
        density: "comfortable",
        panelClassName: "p-0",
        shrinkToContent: true,
        nativeListScroll: true,
      }),
    );
    const workspacePicker = renderToStaticMarkup(
      createElement(GroupedCommandMenu, {
        groups: [{ items: [item("workspace")] }],
        searchPlaceholder: "Search workspaces",
        emptyMessage: "No workspaces",
        menuMode: "workspace-picker",
        density: "comfortable",
        panelClassName: "p-0",
        shrinkToContent: true,
        nativeListScroll: true,
      }),
    );
    const modelPicker = renderToStaticMarkup(
      createElement(GroupedCommandMenu, {
        groups: [{ items: [item("model")] }],
        searchPlaceholder: "Search models",
        emptyMessage: "No models",
        menuMode: "model-picker",
        panelHeightPx: 288,
        nativeListScroll: true,
      }),
    );
    const contentFitHostPicker = renderToStaticMarkup(
      createElement(GroupedCommandMenu, {
        groups: [{ items: [item("host")] }],
        searchPlaceholder: "",
        emptyMessage: "No hosts",
        menuMode: "host-picker",
        showSearch: false,
        shrinkToContent: true,
      }),
    );
    const groupedCommandField = renderToStaticMarkup(
      createElement(GroupedCommandMenu, {
        groups: [{ items: [item("agent")] }],
        searchPlaceholder: "Search agents",
        emptyMessage: "No agents",
        menuMode: "grouped-command-field",
        panelHeightPx: 334,
        panelClassName:
          "max-h-[min(var(--grouped-command-field-panel-height),var(--radix-popover-content-available-height))]",
      }),
    );

    expect(hostPicker).toContain('data-slot="command-item"');
    expect(hostPicker).toContain("data-grouped-command-group-heading");
    expect(hostPicker.match(/data-slot="command-separator"/g)).toHaveLength(3);
    expect(grouped.match(/data-slot="command-separator"/g)).toHaveLength(2);
    for (const picker of [projectPicker, workspacePicker]) {
      expect(picker).toContain('data-menu-density="comfortable"');
      expect(picker).toContain("radix-popover-content-available-height");
      expect(picker).toContain("oma-scrollbar min-h-0 flex-1");
    }
    expect(modelPicker).toContain(
      "radix-dropdown-menu-content-available-height",
    );
    expect(modelPicker).toContain("oma-scrollbar max-h-[60vh] overflow-y-auto");
    expect(contentFitHostPicker).toContain("h-auto flex-none");
    expect(projectPicker).toContain('data-has-query="false"');
    expect(workspacePicker).toContain('data-has-query="false"');
    expect(groupedCommandField).toContain(
      "max-height:min(334px, var(--radix-popover-content-available-height))",
    );
  });

  it("lets the list region shrink with filtered results", () => {
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const start = styles.indexOf(
      '.grouped-command-menu-scroll [data-slot="command-list"]',
    );
    const end = styles.indexOf("}", start);
    const block = styles.slice(start, end);
    expect(block).toContain("height: auto");
    expect(block).not.toContain("min-height: var(--grouped-command-list-height)");
    expect(styles).not.toContain(
      '[data-composer-select-menu-mode="project-picker"] [cmdk-list-sizer]',
    );
    expect(styles).not.toContain(
      '[data-composer-select-menu-mode="workspace-picker"] [cmdk-list-sizer]',
    );
  });

  it("hides empty provider headings without removing items from the cmdk list", () => {
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    expect(styles).toContain("[data-grouped-command-group-heading]:not(");
    expect(styles).toContain('[cmdk-item]:not([aria-disabled="true"])');
  });
});
