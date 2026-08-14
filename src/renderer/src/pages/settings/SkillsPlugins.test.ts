import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { toggleDisabledPlugin } from "./skills-plugins-settings.js";

describe("Skills & Plugins settings", () => {
  it("adds and removes manifest names from the global disabled list", () => {
    expect(toggleDisabledPlugin(["docs"], "browser", false)).toEqual([
      "browser",
      "docs",
    ]);
    expect(toggleDisabledPlugin(["browser", "docs"], "browser", true)).toEqual([
      "docs",
    ]);
  });

  it("is reachable from the integrations section", async () => {
    const layout = await readFile(new URL("./SettingsLayout.tsx", import.meta.url), "utf8");
    const router = await readFile(new URL("../../router.tsx", import.meta.url), "utf8");

    expect(layout).toContain('to: "/settings/skills-plugins"');
    expect(layout).toContain('labelKey: "settings.skillsPlugins"');
    expect(router).toContain('path: "/skills-plugins"');
    expect(router).toContain("SettingsSkillsPlugins");
  });
});
