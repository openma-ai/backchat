import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const CONTENT_PAGES = [
  new URL("../../pages/Scheduled.tsx", import.meta.url),
  new URL("../../pages/settings/Appearance.tsx", import.meta.url),
  new URL("../../pages/settings/Activity.tsx", import.meta.url),
  new URL("../../pages/settings/Agents.tsx", import.meta.url),
  new URL("../../pages/settings/McpServers.tsx", import.meta.url),
  new URL("../../pages/settings/Browser.tsx", import.meta.url),
  new URL("../../pages/settings/Archive.tsx", import.meta.url),
  new URL("../../pages/settings/About.tsx", import.meta.url),
];

describe("PageScaffold", () => {
  it("matches the appearance column, title, and description", async () => {
    const source = await readFile(new URL("./PageScaffold.tsx", import.meta.url), "utf8");

    expect(source).toContain("mx-auto max-w-[800px] space-y-8 text-xs");
    expect(source).toContain("text-2xl font-medium tracking-[-0.02em]");
    expect(source).toContain("mt-2 max-w-[68ch] text-xs leading-5 text-fg-muted");
    expect(source).toContain("w-full px-8 pb-16 pt-20");
    expect(source).not.toContain("max-w-[960px]");
    expect(source).not.toContain("pt-8");
  });

  it("is the skeleton for scheduled and settings content pages", async () => {
    const layout = await readFile(
      new URL("../../pages/settings/SettingsLayout.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).toContain("<ContentPage>");
    expect(layout).not.toContain("PageSurface");

    for (const file of CONTENT_PAGES) {
      const source = await readFile(file, "utf8");
      expect(source, file.pathname).toContain("PageScaffold");
    }
  });
});
