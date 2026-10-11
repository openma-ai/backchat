import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GroupedCommandMenu,
  groupedCommandMenuPanelClassName,
} from "./grouped-command-menu";

describe("groupedCommandMenuPanelClassName", () => {
  it("caps height without forcing a minimum panel height", () => {
    const className = groupedCommandMenuPanelClassName({ maxHeightPx: 336 });
    expect(className).toContain("h-auto");
    expect(className).toContain("max-h-[min(336px");
    expect(className).not.toContain("min-h-[");
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

    expect(hostPicker).toContain('data-slot="command-item"');
    expect(hostPicker).toContain("data-grouped-command-group-heading");
    expect(hostPicker.match(/data-slot="command-separator"/g)).toHaveLength(3);
    expect(grouped.match(/data-slot="command-separator"/g)).toHaveLength(2);
  });

  it("lets the list region shrink with filtered results", () => {
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const block = styles.slice(
      styles.indexOf(".grouped-command-menu-scroll"),
      styles.indexOf(".grouped-command-menu [data-slot=\"command-list\"]"),
    );
    expect(block).toContain("height: auto");
    expect(block).not.toContain("min-height: var(--grouped-command-list-height)");
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
