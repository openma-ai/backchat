import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Backchat Chrome extension manifest", () => {
  it("uses MV3 with browser automation permissions declared up front", () => {
    const manifest = JSON.parse(readFileSync(
      resolve(__dirname, "../manifest.json"),
      "utf8",
    )) as {
      manifest_version: number;
      permissions?: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
      action?: { default_popup?: string; default_title?: string };
      background?: { service_worker?: string; type?: string };
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toMatchObject({
      service_worker: "background.js",
      type: "module",
    });
    expect(manifest.permissions).toEqual([
      "activeTab",
      "alarms",
      "debugger",
      "scripting",
      "storage",
      "tabs",
      "webNavigation",
    ]);
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(manifest.optional_host_permissions ?? []).toEqual([]);
    expect(manifest.action).toMatchObject({
      default_title: "Backchat Browser Bridge",
      default_popup: "popup.html",
    });
  });

  it("points at a directly loadable background worker artifact", () => {
    const background = readFileSync(
      resolve(__dirname, "../background.js"),
      "utf8",
    );

    expect(background).not.toContain("./src/");
    expect(background).toContain("chrome.runtime.onMessage");
    expect(background).toContain("chrome.alarms");
    expect(background).toContain("const DEFAULT_BRIDGE_PORT = 29174");
    expect(background).toContain("const REGISTER_TIMEOUT_MS");
    expect(background).toContain("function fetchWithTimeout");
    expect(background).toContain("scheduleBridgePoll(1)");
    expect(background).toContain("/commands/next");
    expect(background).toContain("/commands/result");
    expect(background).toContain("function executeFrameLocatorScript");
    expect(background).toContain("function resolveChildFrameTarget");
    expect(background).toContain("chrome.webNavigation.getAllFrames");
    expect(background).toContain("sameUrlIndex");
    expect(background).toContain("chrome.debugger.onEvent");
    expect(background).toContain("Page.handleJavaScriptDialog");
    expect(background).toContain("Input.dispatchMouseEvent");
    expect(background).toContain("centerPoint");
    expect(background).toContain("target: { tabId, allFrames: true }");
    expect(background).toContain("frameIds: [frameId]");
  });

  it("ships directly loadable popup assets for user-visible bridge status", () => {
    const popupHtml = readFileSync(
      resolve(__dirname, "../popup.html"),
      "utf8",
    );
    const popupCss = readFileSync(
      resolve(__dirname, "../popup.css"),
      "utf8",
    );
    const popupJs = readFileSync(
      resolve(__dirname, "../popup.js"),
      "utf8",
    );

    expect(popupHtml).toContain('<link rel="stylesheet" href="popup.css">');
    expect(popupHtml).toContain('<script type="module" src="popup.js"></script>');
    expect(popupHtml).not.toContain("<script>");
    expect(popupHtml).toContain("data-status");
    expect(popupHtml).toContain("data-pause-toggle");
    expect(popupHtml).toContain("data-port-input");
    expect(popupHtml).toContain("data-diagnostics");
    expect(popupCss).toContain("prefers-color-scheme: dark");
    expect(popupCss).toContain(":focus-visible");
    expect(popupJs).toContain("bridge.status");
    expect(popupJs).toContain("bridge.setPaused");
    expect(popupJs).toContain("bridge.setPort");
  });
});
