import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("settings sidebar", () => {
  it("returns directly to the app home instead of traversing history", async () => {
    const source = await readFile(new URL("./SettingsLayout.tsx", import.meta.url), "utf8");

    // Settings opened from a chat returns to that chat; the default target
    // stays the app home. Either way it is a direct navigate, never history.
    expect(source).toContain('SettingsSidebar({ returnTo = "/" }');
    expect(source).toContain("navigate({ to: returnTo as never })");
    expect(source).not.toContain("router.history.back()");
  });

  it("does not render the legacy chat settings footer", async () => {
    const source = await readFile(new URL("./SettingsLayout.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("settings.chatSettings");
  });

  it("puts the local activity dashboard in the primary settings section", async () => {
    const source = await readFile(new URL("./SettingsLayout.tsx", import.meta.url), "utf8");
    expect(source).toContain('to: "/settings/activity"');
    expect(source).toContain('labelKey: "settings.activity"');
  });
});
