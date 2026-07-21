import { describe, expect, it } from "vitest";

import {
  BACKCHAT_BROWSER_EXTENSION_PROTOCOL_VERSION,
  createExtensionRegisterPayload,
  parseBridgeCommand,
} from "./protocol.js";

describe("Chrome extension bridge protocol", () => {
  it("creates a stable registration payload", () => {
    expect(createExtensionRegisterPayload({
      extensionId: "ext-1",
      extensionVersion: "0.1.0",
      instanceId: "instance-1",
      profileName: "Default",
    })).toEqual({
      protocolVersion: BACKCHAT_BROWSER_EXTENSION_PROTOCOL_VERSION,
      type: "extension.register",
      extensionId: "ext-1",
      extensionVersion: "0.1.0",
      instanceId: "instance-1",
      profileName: "Default",
    });
  });

  it("accepts known command envelopes and rejects malformed input", () => {
    expect(parseBridgeCommand({
      id: "cmd-1",
      type: "tab.goto",
      tabId: "123",
      url: "http://127.0.0.1:5173/",
    })).toEqual({
      id: "cmd-1",
      type: "tab.goto",
      tabId: "123",
      url: "http://127.0.0.1:5173/",
    });
    expect(parseBridgeCommand({
      id: "cmd-new",
      type: "tabs.create",
    })).toEqual({
      id: "cmd-new",
      type: "tabs.create",
    });
    expect(parseBridgeCommand({
      id: "cmd-user-tabs",
      type: "tabs.userOpenTabs",
    })).toEqual({
      id: "cmd-user-tabs",
      type: "tabs.userOpenTabs",
    });
    expect(parseBridgeCommand({
      id: "cmd-screenshot",
      type: "tab.screenshot",
      tabId: "123",
      options: {
        fullPage: true,
        clip: { x: 10, y: 20, width: 640, height: 360 },
      },
    })).toEqual({
      id: "cmd-screenshot",
      type: "tab.screenshot",
      tabId: "123",
      options: {
        fullPage: true,
        clip: { x: 10, y: 20, width: 640, height: 360 },
      },
    });

    expect(parseBridgeCommand({
      id: "cmd-dom",
      type: "tab.domSnapshot",
      tabId: "123",
    })).toEqual({
      id: "cmd-dom",
      type: "tab.domSnapshot",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-assets",
      type: "tab.pageAssets",
      tabId: "123",
    })).toEqual({
      id: "cmd-assets",
      type: "tab.pageAssets",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-logs",
      type: "tab.devLogs",
      tabId: "123",
    })).toEqual({
      id: "cmd-logs",
      type: "tab.devLogs",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-reload",
      type: "tab.reload",
      tabId: "123",
    })).toEqual({
      id: "cmd-reload",
      type: "tab.reload",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-back",
      type: "tab.back",
      tabId: "123",
    })).toEqual({
      id: "cmd-back",
      type: "tab.back",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-forward",
      type: "tab.forward",
      tabId: "123",
    })).toEqual({
      id: "cmd-forward",
      type: "tab.forward",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-eval",
      type: "tab.evaluate",
      tabId: "123",
      expression: "document.title",
    })).toEqual({
      id: "cmd-eval",
      type: "tab.evaluate",
      tabId: "123",
      expression: "document.title",
    });
    expect(parseBridgeCommand({
      id: "cmd-click",
      type: "tab.click",
      tabId: "123",
      selector: "#ping",
    })).toEqual({
      id: "cmd-click",
      type: "tab.click",
      tabId: "123",
      selector: "#ping",
    });
    expect(parseBridgeCommand({
      id: "cmd-type",
      type: "tab.type",
      tabId: "123",
      selector: "#name",
      text: "Ada",
    })).toEqual({
      id: "cmd-type",
      type: "tab.type",
      tabId: "123",
      selector: "#name",
      text: "Ada",
    });
    expect(parseBridgeCommand({
      id: "cmd-keypress",
      type: "tab.keypress",
      tabId: "123",
      key: "Enter",
    })).toEqual({
      id: "cmd-keypress",
      type: "tab.keypress",
      tabId: "123",
      key: "Enter",
    });
    expect(parseBridgeCommand({
      id: "cmd-coordinate-click",
      type: "tab.coordinateClick",
      tabId: "123",
      x: 120,
      y: 80,
    })).toEqual({
      id: "cmd-coordinate-click",
      type: "tab.coordinateClick",
      tabId: "123",
      x: 120,
      y: 80,
    });
    expect(parseBridgeCommand({
      id: "cmd-dom-cua-snapshot",
      type: "tab.domCuaSnapshot",
      tabId: "123",
    })).toEqual({
      id: "cmd-dom-cua-snapshot",
      type: "tab.domCuaSnapshot",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-dom-cua-click",
      type: "tab.domCuaClick",
      tabId: "123",
      nodeId: "4",
    })).toEqual({
      id: "cmd-dom-cua-click",
      type: "tab.domCuaClick",
      tabId: "123",
      nodeId: "4",
    });
    expect(parseBridgeCommand({
      id: "cmd-dialog",
      type: "tab.dialog",
      tabId: "123",
    })).toEqual({
      id: "cmd-dialog",
      type: "tab.dialog",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-dialog-accept",
      type: "tab.dialogAccept",
      tabId: "123",
      promptText: "typed",
    })).toEqual({
      id: "cmd-dialog-accept",
      type: "tab.dialogAccept",
      tabId: "123",
      promptText: "typed",
    });
    expect(parseBridgeCommand({
      id: "cmd-dialog-dismiss",
      type: "tab.dialogDismiss",
      tabId: "123",
    })).toEqual({
      id: "cmd-dialog-dismiss",
      type: "tab.dialogDismiss",
      tabId: "123",
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-count",
      type: "tab.locatorCount",
      tabId: "123",
      locator: { kind: "role", role: "button", name: "Submit", exact: true },
    })).toEqual({
      id: "cmd-locator-count",
      type: "tab.locatorCount",
      tabId: "123",
      locator: { kind: "role", role: "button", name: "Submit", exact: true },
    });
    expect(parseBridgeCommand({
      id: "cmd-frame-locator-count",
      type: "tab.locatorCount",
      tabId: "123",
      locator: {
        kind: "frame",
        frame: { kind: "css", selector: "iframe" },
        locator: { kind: "testId", value: "frame-button" },
      },
    })).toEqual({
      id: "cmd-frame-locator-count",
      type: "tab.locatorCount",
      tabId: "123",
      locator: {
        kind: "frame",
        frame: { kind: "css", selector: "iframe" },
        locator: { kind: "testId", value: "frame-button" },
      },
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-click",
      type: "tab.locatorClick",
      tabId: "123",
      locator: { kind: "text", value: "Submit", index: 1 },
    })).toEqual({
      id: "cmd-locator-click",
      type: "tab.locatorClick",
      tabId: "123",
      locator: { kind: "text", value: "Submit", index: 1 },
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-fill",
      type: "tab.locatorFill",
      tabId: "123",
      locator: { kind: "label", value: "Name", exact: true },
      text: "Ada",
    })).toEqual({
      id: "cmd-locator-fill",
      type: "tab.locatorFill",
      tabId: "123",
      locator: { kind: "label", value: "Name", exact: true },
      text: "Ada",
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-text",
      type: "tab.locatorInnerText",
      tabId: "123",
      locator: { kind: "testId", value: "submit-button" },
    })).toEqual({
      id: "cmd-locator-text",
      type: "tab.locatorInnerText",
      tabId: "123",
      locator: { kind: "testId", value: "submit-button" },
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-attribute",
      type: "tab.locatorAttribute",
      tabId: "123",
      locator: { kind: "css", selector: "#submit" },
      name: "data-state",
    })).toEqual({
      id: "cmd-locator-attribute",
      type: "tab.locatorAttribute",
      tabId: "123",
      locator: { kind: "css", selector: "#submit" },
      name: "data-state",
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-press",
      type: "tab.locatorPress",
      tabId: "123",
      locator: { kind: "text", value: "Submit" },
      key: "Enter",
    })).toEqual({
      id: "cmd-locator-press",
      type: "tab.locatorPress",
      tabId: "123",
      locator: { kind: "text", value: "Submit" },
      key: "Enter",
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-check",
      type: "tab.locatorSetChecked",
      tabId: "123",
      locator: { kind: "label", value: "Subscribe" },
      checked: true,
    })).toEqual({
      id: "cmd-locator-check",
      type: "tab.locatorSetChecked",
      tabId: "123",
      locator: { kind: "label", value: "Subscribe" },
      checked: true,
    });
    expect(parseBridgeCommand({
      id: "cmd-locator-select",
      type: "tab.locatorSelectOption",
      tabId: "123",
      locator: { kind: "label", value: "Mode" },
      value: "auto",
    })).toEqual({
      id: "cmd-locator-select",
      type: "tab.locatorSelectOption",
      tabId: "123",
      locator: { kind: "label", value: "Mode" },
      value: "auto",
    });

    expect(() => parseBridgeCommand(null)).toThrow("Bridge command must be an object");
    expect(() => parseBridgeCommand({ id: "cmd-2", type: "tab.goto", tabId: "123" }))
      .toThrow("tab.goto command requires url");
    expect(() => parseBridgeCommand({ id: "cmd-4", type: "tab.click", tabId: "123" }))
      .toThrow("tab.click command requires selector");
    expect(() => parseBridgeCommand({
      id: "cmd-locator-bad",
      type: "tab.locatorCount",
      tabId: "123",
    })).toThrow("tab.locatorCount command requires locator");
    expect(() => parseBridgeCommand({
      id: "cmd-frame-locator-bad",
      type: "tab.locatorCount",
      tabId: "123",
      locator: { kind: "frame", frame: { kind: "css", selector: "iframe" } },
    })).toThrow("tab.locatorCount command requires locator.locator");
    expect(() => parseBridgeCommand({
      id: "cmd-locator-attr-bad",
      type: "tab.locatorAttribute",
      tabId: "123",
      locator: { kind: "css", selector: "#submit" },
    })).toThrow("tab.locatorAttribute command requires name");
    expect(() => parseBridgeCommand({
      id: "cmd-locator-press-bad",
      type: "tab.locatorPress",
      tabId: "123",
      locator: { kind: "text", value: "Submit" },
    })).toThrow("tab.locatorPress command requires key");
    expect(() => parseBridgeCommand({
      id: "cmd-locator-check-bad",
      type: "tab.locatorSetChecked",
      tabId: "123",
      locator: { kind: "label", value: "Subscribe" },
    })).toThrow("tab.locatorSetChecked command requires checked");
    expect(() => parseBridgeCommand({
      id: "cmd-locator-select-bad",
      type: "tab.locatorSelectOption",
      tabId: "123",
      locator: { kind: "label", value: "Mode" },
    })).toThrow("tab.locatorSelectOption command requires value");
    expect(() => parseBridgeCommand({
      id: "cmd-locator-index-bad",
      type: "tab.locatorClick",
      tabId: "123",
      locator: { kind: "text", value: "Submit", index: -1 },
    })).toThrow("tab.locatorClick command requires locator.index");
    expect(() => parseBridgeCommand({
      id: "cmd-coordinate-click-bad",
      type: "tab.coordinateClick",
      tabId: "123",
      x: Number.NaN,
      y: 80,
    })).toThrow("tab.coordinateClick command requires finite x and y");
    expect(() => parseBridgeCommand({
      id: "cmd-screenshot-bad",
      type: "tab.screenshot",
      tabId: "123",
      options: { clip: { x: 0, y: 0, width: 0, height: 360 } },
    })).toThrow("tab.screenshot command requires positive clip width and height");
    expect(() => parseBridgeCommand({
      id: "cmd-dom-cua-click-bad",
      type: "tab.domCuaClick",
      tabId: "123",
    })).toThrow("tab.domCuaClick command requires nodeId");
    expect(() => parseBridgeCommand({ id: "cmd-3", type: "unknown" }))
      .toThrow("Unsupported bridge command: unknown");
  });
});
