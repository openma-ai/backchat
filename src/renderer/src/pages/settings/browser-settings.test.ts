import { describe, expect, it } from "vitest";
import type { BrowserDescriptor } from "@shared/browser-plugin";
import {
  CHROME_EXTENSION_LOAD_PATH,
  CHROME_EXTENSION_REQUIRED_PERMISSIONS,
  deriveBrowserSettingsModel,
} from "./browser-settings";

function descriptor(overrides: Partial<BrowserDescriptor>): BrowserDescriptor {
  return {
    id: "chrome-extension",
    type: "extension",
    name: "Chrome Extension",
    metadata: {},
    capabilities: { browser: [], tab: [] },
    ...overrides,
  };
}

describe("deriveBrowserSettingsModel", () => {
  it("shows Chrome extension registration details when the bridge is connected", () => {
    const model = deriveBrowserSettingsModel([
      descriptor({
        metadata: {
          bridgePort: "29174",
          extensionId: "ext-1",
          extensionVersion: "0.1.0",
          instanceId: "instance-1",
          profileName: "Default",
        },
      }),
    ]);

    expect(model.extension.status).toBe("connected");
    expect(model.extension.statusLabel).toBe("Connected");
    expect(model.extension.summary).toBe("Chrome tabs are available to Backchat tools.");
    expect(model.extension.rows).toEqual([
      { label: "Bridge port", value: "29174" },
      { label: "Extension ID", value: "ext-1" },
      { label: "Version", value: "0.1.0" },
      { label: "Profile", value: "Default" },
      { label: "Instance", value: "instance-1" },
    ]);
  });

  it("turns a missing registration into actionable load and permission details", () => {
    const model = deriveBrowserSettingsModel([
      descriptor({ metadata: { bridgePort: "29174" } }),
    ]);

    expect(model.extension.status).toBe("waiting");
    expect(model.extension.statusLabel).toBe("Waiting for extension");
    expect(model.extension.summary).toBe("Load the unpacked extension and leave automation allowed in its popup.");
    expect(model.extension.loadPath).toBe(CHROME_EXTENSION_LOAD_PATH);
    expect(model.extension.requiredPermissions).toEqual(CHROME_EXTENSION_REQUIRED_PERMISSIONS);
    expect(model.extension.rows).toEqual([
      { label: "Bridge port", value: "29174" },
      { label: "Extension path", value: CHROME_EXTENSION_LOAD_PATH },
    ]);
  });

  it("surfaces command timeout metadata as a user-visible extension error", () => {
    const model = deriveBrowserSettingsModel([
      descriptor({
        metadata: {
          bridgePort: "29174",
          extensionId: "ext-1",
          extensionVersion: "0.1.0",
          bridgeStatus: "command-timeout",
          bridgeLastCommandType: "tab.screenshot",
          bridgeLastError: "Chrome extension command timed out: tab.screenshot",
          bridgePendingCommands: "0",
          bridgeQueuedCommands: "0",
        },
      }),
    ]);

    expect(model.extension.status).toBe("error");
    expect(model.extension.statusLabel).toBe("Command timeout");
    expect(model.extension.summary).toBe("The Chrome extension bridge is registered, but the last command failed.");
    expect(model.extension.rows).toEqual([
      { label: "Bridge port", value: "29174" },
      { label: "Bridge status", value: "command-timeout" },
      { label: "Extension ID", value: "ext-1" },
      { label: "Version", value: "0.1.0" },
      { label: "Last command", value: "tab.screenshot" },
      { label: "Last error", value: "Chrome extension command timed out: tab.screenshot" },
      { label: "Pending", value: "0" },
      { label: "Queued", value: "0" },
    ]);
  });

  it("keeps the in-app browser separate from the Chrome extension backend", () => {
    const model = deriveBrowserSettingsModel([
      descriptor({
        id: "in-app",
        type: "iab",
        name: "Backchat In-app Browser",
        capabilities: {
          browser: [{ id: "visibility", description: "Attach the browser view." }],
          tab: [{ id: "screenshot", description: "Capture the current page." }],
        },
      }),
    ]);

    expect(model.inApp.status).toBe("available");
    expect(model.inApp.rows).toEqual([
      { label: "Backend", value: "Electron in-app browser" },
      { label: "Capabilities", value: "2" },
    ]);
    expect(model.extension.status).toBe("unavailable");
    expect(model.extension.rows).toContainEqual({
      label: "Extension path",
      value: CHROME_EXTENSION_LOAD_PATH,
    });
  });
});
