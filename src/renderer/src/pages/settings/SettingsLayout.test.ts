import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("settings sidebar", () => {
  it("returns to the actual app route instead of forcing the home route", async () => {
    const source = await readFile(new URL("./SettingsLayout.tsx", import.meta.url), "utf8");

    expect(source).toContain("router.history.canGoBack()");
    expect(source).toContain("router.history.back()");
    expect(source).not.toContain('to="/"');
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
