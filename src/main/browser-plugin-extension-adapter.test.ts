import { describe, expect, it } from "vitest";

import {
  createChromeExtensionBrowserAdapter,
  type ChromeExtensionBridgeCommand,
} from "./browser-plugin-extension-adapter.js";

describe("createChromeExtensionBrowserAdapter", () => {
  it("translates BrowserBackendAdapter calls into Chrome extension bridge commands", async () => {
    const commands: ChromeExtensionBridgeCommand[] = [];
    const adapter = createChromeExtensionBrowserAdapter({
      bridge: {
        registration: {
          extensionId: "ext-1",
          extensionVersion: "0.1.0",
          instanceId: "instance-1",
          profileName: "Default",
        },
        async sendCommand(command) {
          commands.push(command);
          if (command.type === "tabs.list") {
            return [{ id: "7", title: "Probe", url: "http://127.0.0.1:5173/" }];
          }
          if (command.type === "tabs.userOpenTabs") {
            return [{ id: "9", title: "Chrome Docs", url: "https://example.com/docs" }];
          }
          if (command.type === "tabs.create") {
            return { id: "8", title: "New", url: "about:blank" };
          }
          if (command.type === "tab.goto") {
            return { id: command.tabId, title: "Probe", url: command.url };
          }
          if (command.type === "tab.screenshot") {
            return "data:image/jpeg;base64,/9j/";
          }
          if (command.type === "tab.devLogs") {
            return [{
              level: "warn",
              message: "clicked-log",
              timestamp: "2026-07-02T00:00:00.000Z",
              url: "http://127.0.0.1:5173/",
            }];
          }
          if (command.type === "tab.domSnapshot") return "Ping\nName";
          if (command.type === "tab.evaluate") return "Probe";
          if (command.type === "tab.coordinateClick") return null;
          if (command.type === "tab.domCuaSnapshot") return '<button node_id="1">Ping</button>';
          if (command.type === "tab.domCuaClick") return null;
          if (command.type === "tab.locatorCount") return 2;
          if (command.type === "tab.locatorInnerText") return "Submit";
          if (command.type === "tab.locatorAttribute") return "ready";
          if (command.type === "tab.dialog") return { type: "confirm", message: "Continue?" };
          if (command.type === "tab.pageAssets") {
            return [
              { url: "http://127.0.0.1:5173/app.js", type: "script", tagName: "script" },
              { url: "http://127.0.0.1:5173/logo.png", type: "image", tagName: "img" },
            ];
          }
          if (command.type === "tab.reload" || command.type === "tab.back" || command.type === "tab.forward") {
            return { id: command.tabId, title: "Probe", url: "http://127.0.0.1:5173/" };
          }
          return null;
        },
      },
    });

    expect(adapter.descriptor).toMatchObject({
      id: "chrome-extension",
      type: "extension",
      name: "Chrome Extension",
      metadata: {
        extensionId: "ext-1",
        extensionVersion: "0.1.0",
        instanceId: "instance-1",
        profileName: "Default",
      },
    });
    expect(adapter.descriptor.capabilities.tab.map((capability) => capability.id))
      .toEqual([
        "history",
        "pageAssets",
        "domSnapshot",
        "evaluate",
        "input",
        "cua",
        "domCua",
        "locators",
        "dialogs",
      ]);

    await expect(adapter.listTabs()).resolves.toEqual([
      { id: "7", title: "Probe", url: "http://127.0.0.1:5173/" },
    ]);
    await expect((adapter as unknown as {
      userTabs(): Promise<Array<{ id: string; title?: string; url?: string }>>;
    }).userTabs()).resolves.toEqual([
      { id: "9", title: "Chrome Docs", url: "https://example.com/docs" },
    ]);
    await expect(adapter.createTab()).resolves.toEqual({
      id: "8",
      title: "New",
      url: "about:blank",
    });
    await expect(adapter.navigate("7", "http://127.0.0.1:3000/"))
      .resolves.toEqual({ id: "7", title: "Probe", url: "http://127.0.0.1:3000/" });
    await expect(adapter.screenshot("7")).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    });
    await expect(adapter.devLogs("7")).resolves.toEqual([{
      level: "warn",
      message: "clicked-log",
      timestamp: "2026-07-02T00:00:00.000Z",
      url: "http://127.0.0.1:5173/",
    }]);
    await expect(adapter.domSnapshot?.("7")).resolves.toBe("Ping\nName");
    await expect(adapter.evaluate?.("7", "document.title")).resolves.toBe("Probe");
    await expect(adapter.click?.("7", "#ping")).resolves.toBeUndefined();
    await expect(adapter.type?.("7", "#name", "Ada")).resolves.toBeUndefined();
    await expect(adapter.press?.("7", "Enter")).resolves.toBeUndefined();
    await expect(adapter.coordinateClick?.("7", 120, 80)).resolves.toBeUndefined();
    await expect(adapter.domCuaSnapshot?.("7")).resolves.toBe('<button node_id="1">Ping</button>');
    await expect(adapter.domCuaClick?.("7", "1")).resolves.toBeUndefined();
    await expect(adapter.locatorCount?.("7", {
      kind: "role",
      role: "button",
      name: "Submit",
      exact: true,
    })).resolves.toBe(2);
    await expect(adapter.locatorInnerText?.("7", {
      kind: "text",
      value: "Submit",
      exact: true,
    })).resolves.toBe("Submit");
    await expect(adapter.locatorAttribute?.("7", {
      kind: "testId",
      value: "submit-button",
    }, "data-state")).resolves.toBe("ready");
    await expect(adapter.locatorClick?.("7", {
      kind: "role",
      role: "button",
      name: "Submit",
      index: 1,
    })).resolves.toBeUndefined();
    await expect(adapter.locatorFill?.("7", {
      kind: "label",
      value: "Name",
    }, "Ada")).resolves.toBeUndefined();
    await expect(adapter.locatorPress?.("7", {
      kind: "text",
      value: "Submit",
    }, "Enter")).resolves.toBeUndefined();
    await expect(adapter.locatorSetChecked?.("7", {
      kind: "label",
      value: "Subscribe",
    }, true)).resolves.toBeUndefined();
    await expect(adapter.locatorSelectOption?.("7", {
      kind: "label",
      value: "Mode",
    }, "auto")).resolves.toBeUndefined();
    await expect(adapter.getDialog?.("7")).resolves.toEqual({
      type: "confirm",
      message: "Continue?",
    });
    await expect(adapter.acceptDialog?.("7", "typed")).resolves.toBeUndefined();
    await expect(adapter.dismissDialog?.("7")).resolves.toBeUndefined();
    await expect(adapter.pageAssets?.("7")).resolves.toEqual([
      { url: "http://127.0.0.1:5173/app.js", type: "script", tagName: "script" },
      { url: "http://127.0.0.1:5173/logo.png", type: "image", tagName: "img" },
    ]);
    await expect(adapter.reload?.("7")).resolves.toMatchObject({ id: "7" });
    await expect(adapter.back?.("7")).resolves.toMatchObject({ id: "7" });
    await expect(adapter.forward?.("7")).resolves.toMatchObject({ id: "7" });

    expect(commands).toEqual([
      { id: expect.any(String), type: "tabs.list" },
      { id: expect.any(String), type: "tabs.userOpenTabs" },
      { id: expect.any(String), type: "tabs.create" },
      { id: expect.any(String), type: "tab.goto", tabId: "7", url: "http://127.0.0.1:3000/" },
      { id: expect.any(String), type: "tab.screenshot", tabId: "7" },
      { id: expect.any(String), type: "tab.devLogs", tabId: "7" },
      { id: expect.any(String), type: "tab.domSnapshot", tabId: "7" },
      { id: expect.any(String), type: "tab.evaluate", tabId: "7", expression: "document.title" },
      { id: expect.any(String), type: "tab.click", tabId: "7", selector: "#ping" },
      { id: expect.any(String), type: "tab.type", tabId: "7", selector: "#name", text: "Ada" },
      { id: expect.any(String), type: "tab.keypress", tabId: "7", key: "Enter" },
      { id: expect.any(String), type: "tab.coordinateClick", tabId: "7", x: 120, y: 80 },
      { id: expect.any(String), type: "tab.domCuaSnapshot", tabId: "7" },
      { id: expect.any(String), type: "tab.domCuaClick", tabId: "7", nodeId: "1" },
      {
        id: expect.any(String),
        type: "tab.locatorCount",
        tabId: "7",
        locator: { kind: "role", role: "button", name: "Submit", exact: true },
      },
      {
        id: expect.any(String),
        type: "tab.locatorInnerText",
        tabId: "7",
        locator: { kind: "text", value: "Submit", exact: true },
      },
      {
        id: expect.any(String),
        type: "tab.locatorAttribute",
        tabId: "7",
        locator: { kind: "testId", value: "submit-button" },
        name: "data-state",
      },
      {
        id: expect.any(String),
        type: "tab.locatorClick",
        tabId: "7",
        locator: { kind: "role", role: "button", name: "Submit", index: 1 },
      },
      {
        id: expect.any(String),
        type: "tab.locatorFill",
        tabId: "7",
        locator: { kind: "label", value: "Name" },
        text: "Ada",
      },
      {
        id: expect.any(String),
        type: "tab.locatorPress",
        tabId: "7",
        locator: { kind: "text", value: "Submit" },
        key: "Enter",
      },
      {
        id: expect.any(String),
        type: "tab.locatorSetChecked",
        tabId: "7",
        locator: { kind: "label", value: "Subscribe" },
        checked: true,
      },
      {
        id: expect.any(String),
        type: "tab.locatorSelectOption",
        tabId: "7",
        locator: { kind: "label", value: "Mode" },
        value: "auto",
      },
      { id: expect.any(String), type: "tab.dialog", tabId: "7" },
      {
        id: expect.any(String),
        type: "tab.dialogAccept",
        tabId: "7",
        promptText: "typed",
      },
      { id: expect.any(String), type: "tab.dialogDismiss", tabId: "7" },
      { id: expect.any(String), type: "tab.pageAssets", tabId: "7" },
      { id: expect.any(String), type: "tab.reload", tabId: "7" },
      { id: expect.any(String), type: "tab.back", tabId: "7" },
      { id: expect.any(String), type: "tab.forward", tabId: "7" },
    ]);
  });

  it("reflects bridge registration metadata dynamically in the descriptor", () => {
    let registration = null as null | {
      protocolVersion: 1;
      type: "extension.register";
      extensionId: string;
      extensionVersion: string;
      instanceId: string;
      profileName?: string;
    };
    const adapter = createChromeExtensionBrowserAdapter({
      bridge: {
        get registration() {
          return registration;
        },
        async sendCommand() {
          return null;
        },
      },
    });

    expect(adapter.descriptor.metadata).toEqual({});

    registration = {
      protocolVersion: 1,
      type: "extension.register",
      extensionId: "ext-1",
      extensionVersion: "0.1.0",
      instanceId: "instance-1",
      profileName: "Default",
    };

    expect(adapter.descriptor.metadata).toMatchObject({
      extensionId: "ext-1",
      extensionVersion: "0.1.0",
      instanceId: "instance-1",
      profileName: "Default",
    });
  });

  it("reflects dynamic option metadata in the descriptor", () => {
    let bridgePort = "0";
    const adapter = createChromeExtensionBrowserAdapter({
      metadata: () => ({ bridgePort }),
      bridge: {
        async sendCommand() {
          return null;
        },
      },
    });

    expect(adapter.descriptor.metadata).toEqual({ bridgePort: "0" });
    bridgePort = "49152";
    expect(adapter.descriptor.metadata).toEqual({ bridgePort: "49152" });
  });

  it("forwards screenshot options to the Chrome extension bridge", async () => {
    const commands: ChromeExtensionBridgeCommand[] = [];
    const adapter = createChromeExtensionBrowserAdapter({
      bridge: {
        async sendCommand(command) {
          commands.push(command);
          return "data:image/jpeg;base64,/9j/";
        },
      },
    });

    await expect(adapter.screenshot("7", {
      fullPage: true,
      clip: { x: 10, y: 20, width: 640, height: 360 },
    })).resolves.toMatchObject({
      mimeType: "image/jpeg",
    });

    expect(commands).toEqual([
      {
        id: expect.any(String),
        type: "tab.screenshot",
        tabId: "7",
        options: {
          fullPage: true,
          clip: { x: 10, y: 20, width: 640, height: 360 },
        },
      },
    ]);
  });
});
