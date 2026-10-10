import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { groupedCommandMenuPanelClassName } from "./grouped-command-menu";

describe("groupedCommandMenuPanelClassName", () => {
  it("caps height without forcing a minimum panel height", () => {
    const className = groupedCommandMenuPanelClassName({ maxHeightPx: 336 });
    expect(className).toContain("h-auto");
    expect(className).toContain("max-h-[min(336px");
    expect(className).not.toContain("min-h-[");
  });
});

describe("grouped command menu styles", () => {
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
});
