import { describe, expect, it } from "vitest";

import {
  DEFAULT_BROWSER_SETTINGS,
  browserOpenTarget,
  browserSettings,
  shouldAttachBrowserAnnotationScreenshot,
} from "./browser-settings.js";

describe("browserSettings", () => {
  it("keeps existing installs on conservative browser defaults", () => {
    expect(browserSettings(undefined)).toEqual(DEFAULT_BROWSER_SETTINGS);
    expect(browserOpenTarget("https://example.com", undefined)).toBe("external");
    expect(browserOpenTarget("http://localhost:5173/settings", undefined)).toBe("in_app");
    expect(browserOpenTarget("file:///tmp/preview.html", undefined)).toBe("in_app");
    expect(shouldAttachBrowserAnnotationScreenshot(undefined)).toBe(true);
  });

  it("preserves explicit browser choices while filling missing fields", () => {
    const settings = browserSettings({
      enabled: false,
      web_link_target: "in_app",
      annotation_screenshots: "never",
      default_zoom: 1.25,
      download_path: "/tmp/downloads",
      ask_before_download: true,
      autofill_enabled: false,
    });

    expect(settings.local_link_target).toBe("in_app");
    expect(settings.default_zoom).toBe(1.25);
    expect(browserOpenTarget("https://example.com", settings)).toBe("external");
    expect(shouldAttachBrowserAnnotationScreenshot(settings)).toBe(false);
  });

  it("routes web and local links independently when the browser is enabled", () => {
    const settings = browserSettings({
      ...DEFAULT_BROWSER_SETTINGS,
      web_link_target: "in_app",
      local_link_target: "external",
    });

    expect(browserOpenTarget("https://example.com", settings)).toBe("in_app");
    expect(browserOpenTarget("http://127.0.0.1:3000", settings)).toBe("external");
  });
});
