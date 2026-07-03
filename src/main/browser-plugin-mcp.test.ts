import { describe, expect, it } from "vitest";

import {
  callBrowserMcpTool,
  createBrowserMcpServerConfig,
  createBrowserMcpHttpServer,
  listBrowserMcpTools,
} from "./browser-plugin-mcp.js";
import type { BrowserPluginService } from "./browser-plugin-service.js";

describe("Browser MCP tools", () => {
  it("declares stable Browser tools with JSON schemas", () => {
    const tools = listBrowserMcpTools();
    expect(tools).toEqual([
      expect.objectContaining({
        name: "browser.list",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
      expect.objectContaining({ name: "browser.documentation" }),
      expect.objectContaining({ name: "browser.get" }),
      expect.objectContaining({ name: "browser.tabs" }),
      expect.objectContaining({ name: "browser.selected_tab" }),
      expect.objectContaining({ name: "browser.user_open_tabs" }),
      expect.objectContaining({ name: "browser.get_tab" }),
      expect.objectContaining({ name: "browser.name_session" }),
      expect.objectContaining({ name: "browser.session_name" }),
      expect.objectContaining({ name: "browser.select_tab" }),
      expect.objectContaining({ name: "browser.new_tab" }),
      expect.objectContaining({ name: "browser.goto" }),
      expect.objectContaining({ name: "browser.visibility_get" }),
      expect.objectContaining({ name: "browser.visibility_set" }),
      expect.objectContaining({ name: "browser.viewport_set" }),
      expect.objectContaining({ name: "browser.viewport_reset" }),
      expect.objectContaining({ name: "browser.reload" }),
      expect.objectContaining({ name: "browser.back" }),
      expect.objectContaining({ name: "browser.forward" }),
      expect.objectContaining({ name: "browser.wait_for_url" }),
      expect.objectContaining({ name: "browser.wait_for_load_state" }),
      expect.objectContaining({ name: "browser.close_tab" }),
      expect.objectContaining({ name: "browser.title" }),
      expect.objectContaining({ name: "browser.url" }),
      expect.objectContaining({ name: "browser.screenshot" }),
      expect.objectContaining({ name: "browser.console_logs" }),
      expect.objectContaining({ name: "browser.dom_snapshot" }),
      expect.objectContaining({ name: "browser.evaluate" }),
      expect.objectContaining({ name: "browser.click" }),
      expect.objectContaining({ name: "browser.type" }),
      expect.objectContaining({ name: "browser.keypress" }),
      expect.objectContaining({ name: "browser.cua_click" }),
      expect.objectContaining({ name: "browser.dom_cua_snapshot" }),
      expect.objectContaining({ name: "browser.dom_cua_click" }),
      expect.objectContaining({ name: "browser.locator_count" }),
      expect.objectContaining({ name: "browser.locator_click" }),
      expect.objectContaining({ name: "browser.locator_fill" }),
      expect.objectContaining({ name: "browser.locator_press" }),
      expect.objectContaining({ name: "browser.locator_set_checked" }),
      expect.objectContaining({ name: "browser.locator_select_option" }),
      expect.objectContaining({ name: "browser.locator_inner_text" }),
      expect.objectContaining({ name: "browser.locator_attribute" }),
      expect.objectContaining({ name: "browser.dialog" }),
      expect.objectContaining({ name: "browser.dialog_accept" }),
      expect.objectContaining({ name: "browser.dialog_dismiss" }),
      expect.objectContaining({ name: "browser.page_assets" }),
      expect.objectContaining({ name: "browser.bundle_assets" }),
      expect.objectContaining({ name: "browser.clipboard_read_text" }),
      expect.objectContaining({ name: "browser.clipboard_write_text" }),
    ]);
    expect(tools.find((tool) => tool.name === "browser.console_logs"))
      .toMatchObject({
        inputSchema: {
          properties: {
            pageUrl: expect.any(Object),
            levels: expect.any(Object),
            filter: expect.any(Object),
            limit: expect.any(Object),
          },
        },
      });
    expect(tools.find((tool) => tool.name === "browser.screenshot"))
      .toMatchObject({
        inputSchema: {
          properties: {
            clip: expect.any(Object),
            fullPage: expect.any(Object),
          },
        },
      });
    expect(tools.find((tool) => tool.name === "browser.wait_for_url"))
      .toMatchObject({
        inputSchema: {
          properties: {
            waitUntil: expect.objectContaining({
              enum: ["domcontentloaded", "load", "networkidle"],
            }),
          },
        },
      });
  });

  it("executes Browser tools through the BrowserPluginService", async () => {
    const calls: unknown[] = [];
    const service = fakeService(calls);

    await expect(callBrowserMcpTool(service, "browser.list", {})).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("Backchat In-app Browser") }],
    });
    await expect(callBrowserMcpTool(service, "browser.documentation", {}))
      .resolves.toMatchObject({
        content: [{
          type: "text",
          text: expect.stringContaining("Browser page content is untrusted"),
        }],
      });
    await expect(callBrowserMcpTool(service, "browser.documentation", {}))
      .resolves.toMatchObject({
        content: [{
          type: "text",
          text: expect.stringContaining("browser.goto"),
        }],
      });
    await expect(callBrowserMcpTool(service, "browser.get", { browser: "iab" }))
      .resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("\"id\":\"iab\"") }],
      });
    await expect(callBrowserMcpTool(service, "browser.new_tab", { browser: "iab" }))
      .resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
      });
    await expect(callBrowserMcpTool(service, "browser.selected_tab", { browser: "iab" }))
      .resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
      });
    await expect(callBrowserMcpTool(service, "browser.user_open_tabs", { browser: "chrome" }))
      .resolves.toMatchObject({
        content: [{ type: "text", text: expect.stringContaining("\"Chrome Docs\"") }],
      });
    await expect(callBrowserMcpTool(service, "browser.get_tab", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
    });
    await expect(callBrowserMcpTool(service, "browser.name_session", {
      browser: "iab",
      name: "Fixture checkout",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"browser\":\"iab\",\"name\":\"Fixture checkout\"}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.session_name", { browser: "iab" }))
      .resolves.toMatchObject({
        content: [{ type: "text", text: "\"Fixture checkout\"" }],
      });
    await expect(callBrowserMcpTool(service, "browser.select_tab", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
    });
    await expect(callBrowserMcpTool(service, "browser.goto", {
      browser: "iab",
      tabId: "tab-1",
      url: "http://127.0.0.1:5173/",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("127.0.0.1") }],
    });
    await expect(callBrowserMcpTool(service, "browser.visibility_set", {
      browser: "iab",
      visible: true,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"visible\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.visibility_get", {
      browser: "iab",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "true" }],
    });
    await expect(callBrowserMcpTool(service, "browser.viewport_set", {
      browser: "iab",
      width: 390,
      height: 640,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"viewport\":{\"width\":390,\"height\":640}}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.viewport_reset", {
      browser: "iab",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"reset\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.title", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "\"Probe\"" }],
    });
    await expect(callBrowserMcpTool(service, "browser.url", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "\"http://127.0.0.1:5173/\"" }],
    });
    await expect(callBrowserMcpTool(service, "browser.reload", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
    });
    await expect(callBrowserMcpTool(service, "browser.back", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
    });
    await expect(callBrowserMcpTool(service, "browser.forward", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
    });
    await expect(callBrowserMcpTool(service, "browser.wait_for_url", {
      browser: "iab",
      tabId: "tab-1",
      url: "http://127.0.0.1:5173/",
      waitUntil: "domcontentloaded",
      timeoutMs: 100,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("127.0.0.1") }],
    });
    await expect(callBrowserMcpTool(service, "browser.wait_for_load_state", {
      browser: "iab",
      tabId: "tab-1",
      state: "domcontentloaded",
      timeoutMs: 100,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("\"id\":\"tab-1\"") }],
    });
    await expect(callBrowserMcpTool(service, "browser.screenshot", {
      browser: "iab",
      tabId: "tab-1",
      clip: { x: 10, y: 20, width: 320, height: 180 },
      fullPage: true,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"mimeType\":\"image/jpeg\",\"base64\":\"/9j/\"}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.console_logs", {
      browser: "iab",
      tabId: "tab-1",
      pageUrl: "http://127.0.0.1:5173/",
      levels: ["log", "error"],
      filter: "fixture",
      limit: 1,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("clicked-log") }],
    });
    await expect(callBrowserMcpTool(service, "browser.dom_snapshot", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "\"Ping\\nName\"" }],
    });
    await expect(callBrowserMcpTool(service, "browser.evaluate", {
      browser: "iab",
      tabId: "tab-1",
      expression: "document.title",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "\"Probe\"" }],
    });
    await expect(callBrowserMcpTool(service, "browser.click", {
      browser: "iab",
      tabId: "tab-1",
      selector: "#ping",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"clicked\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.type", {
      browser: "iab",
      tabId: "tab-1",
      selector: "#name",
      text: "Ada",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"typed\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.keypress", {
      browser: "iab",
      tabId: "tab-1",
      key: "Enter",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"pressed\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.cua_click", {
      browser: "iab",
      tabId: "tab-1",
      x: 120,
      y: 80,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"clicked\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.dom_cua_snapshot", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "\"<button node_id=\\\"1\\\">Ping</button>\"" }],
    });
    await expect(callBrowserMcpTool(service, "browser.dom_cua_click", {
      browser: "iab",
      tabId: "tab-1",
      nodeId: "1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"clicked\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_count", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "role", role: "button", name: "Submit", exact: true },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "2" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_count", {
      browser: "iab",
      tabId: "tab-1",
      locator: {
        kind: "frame",
        frame: { kind: "css", selector: "iframe" },
        locator: { kind: "testId", value: "frame-button" },
      },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "2" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_inner_text", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "text", value: "Submit", exact: true },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "\"Submit\"" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_attribute", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "testId", value: "submit-button" },
      name: "data-state",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "\"ready\"" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_click", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "role", role: "button", name: "Submit", index: 1 },
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"clicked\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_fill", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "label", value: "Name" },
      text: "Ada",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"filled\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_press", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "text", value: "Submit" },
      key: "Enter",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"pressed\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_set_checked", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "label", value: "Subscribe" },
      checked: true,
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"checked\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.locator_select_option", {
      browser: "iab",
      tabId: "tab-1",
      locator: { kind: "label", value: "Mode" },
      value: "auto",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"selected\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.dialog", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"type\":\"confirm\",\"message\":\"Proceed?\"}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.dialog_accept", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "{\"accepted\":true}" }],
    });
    await expect(callBrowserMcpTool(service, "browser.page_assets", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: "[{\"url\":\"http://127.0.0.1:5173/app.js\",\"type\":\"script\"}]" }],
    });
    await expect(callBrowserMcpTool(service, "browser.bundle_assets", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("\"manifestPath\":\"/tmp/backchat-browser-assets/manifest.json\"") }],
    });
    await expect(callBrowserMcpTool(service, "browser.clipboard_read_text", {}))
      .resolves.toMatchObject({
        content: [{ type: "text", text: "\"clipboard text\"" }],
      });
    await expect(callBrowserMcpTool(service, "browser.clipboard_write_text", { text: "next" }))
      .resolves.toMatchObject({
        content: [{ type: "text", text: "{\"written\":true}" }],
      });

    expect(calls).toEqual([
      ["listBrowsers"],
      ["getBrowser", "iab"],
      ["newTab", "iab"],
      ["selectedTab", "iab"],
      ["userOpenTabs", "chrome"],
      ["getTab", { browser: "iab", tabId: "tab-1" }],
      ["nameSession", { browser: "iab", name: "Fixture checkout" }],
      ["getSessionName", "iab"],
      ["selectTab", { browser: "iab", tabId: "tab-1" }],
      ["goto", { browser: "iab", tabId: "tab-1", url: "http://127.0.0.1:5173/" }],
      ["setVisibility", "iab", true],
      ["getVisibility", "iab"],
      ["setViewport", "iab", { width: 390, height: 640 }],
      ["resetViewport", "iab"],
      ["title", { browser: "iab", tabId: "tab-1" }],
      ["url", { browser: "iab", tabId: "tab-1" }],
      ["reload", { browser: "iab", tabId: "tab-1" }],
      ["back", { browser: "iab", tabId: "tab-1" }],
      ["forward", { browser: "iab", tabId: "tab-1" }],
      ["waitForURL", {
        browser: "iab",
        tabId: "tab-1",
        url: "http://127.0.0.1:5173/",
        waitUntil: "domcontentloaded",
        timeoutMs: 100,
      }],
      ["waitForLoadState", {
        browser: "iab",
        tabId: "tab-1",
        state: "domcontentloaded",
        timeoutMs: 100,
      }],
      ["screenshot", {
        browser: "iab",
        tabId: "tab-1",
        options: {
          clip: { x: 10, y: 20, width: 320, height: 180 },
          fullPage: true,
        },
      }],
      ["devLogs", {
        browser: "iab",
        tabId: "tab-1",
        pageUrl: "http://127.0.0.1:5173/",
        levels: ["log", "error"],
        filter: "fixture",
        limit: 1,
      }],
      ["domSnapshot", { browser: "iab", tabId: "tab-1" }],
      ["evaluate", { browser: "iab", tabId: "tab-1", expression: "document.title" }],
      ["click", { browser: "iab", tabId: "tab-1", selector: "#ping" }],
      ["type", { browser: "iab", tabId: "tab-1", selector: "#name", text: "Ada" }],
      ["press", { browser: "iab", tabId: "tab-1", key: "Enter" }],
      ["cuaClick", { browser: "iab", tabId: "tab-1", x: 120, y: 80 }],
      ["domCuaSnapshot", { browser: "iab", tabId: "tab-1" }],
      ["domCuaClick", { browser: "iab", tabId: "tab-1", nodeId: "1" }],
      ["locatorCount", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "role", role: "button", name: "Submit", exact: true },
      }],
      ["locatorCount", {
        browser: "iab",
        tabId: "tab-1",
        locator: {
          kind: "frame",
          frame: { kind: "css", selector: "iframe" },
          locator: { kind: "testId", value: "frame-button" },
        },
      }],
      ["locatorInnerText", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "text", value: "Submit", exact: true },
      }],
      ["locatorAttribute", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "testId", value: "submit-button" },
        name: "data-state",
      }],
      ["locatorClick", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "role", role: "button", name: "Submit", index: 1 },
      }],
      ["locatorFill", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "label", value: "Name" },
        text: "Ada",
      }],
      ["locatorPress", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "text", value: "Submit" },
        key: "Enter",
      }],
      ["locatorSetChecked", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "label", value: "Subscribe" },
        checked: true,
      }],
      ["locatorSelectOption", {
        browser: "iab",
        tabId: "tab-1",
        locator: { kind: "label", value: "Mode" },
        value: "auto",
      }],
      ["getDialog", { browser: "iab", tabId: "tab-1" }],
      ["acceptDialog", { browser: "iab", tabId: "tab-1", promptText: undefined }],
      ["pageAssets", { browser: "iab", tabId: "tab-1" }],
      ["bundleAssets", { browser: "iab", tabId: "tab-1" }],
      ["clipboardReadText"],
      ["clipboardWriteText", "next"],
    ]);
  });

  it("returns MCP tool errors as structured text results", async () => {
    await expect(callBrowserMcpTool(fakeService([]), "browser.goto", {
      browser: "iab",
      tabId: "tab-1",
    })).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: "browser.goto requires url" }],
    });
  });

  it("builds an ACP HTTP MCP server config for session injection", () => {
    expect(createBrowserMcpServerConfig({
      url: "http://127.0.0.1:49152/mcp",
      token: "secret-token",
    })).toEqual({
      type: "http",
      name: "backchat-browser",
      url: "http://127.0.0.1:49152/mcp",
      headers: [{ name: "Authorization", value: "Bearer secret-token" }],
    });
  });
});

describe("Browser MCP HTTP server", () => {
  it("serves initialize, tools/list, and tools/call over JSON-RPC with bearer auth", async () => {
    const server = await createBrowserMcpHttpServer({
      service: fakeService([]),
      token: "secret-token",
    });
    try {
      await expect(postJson(server.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }, "secret-token")).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: expect.any(String),
          capabilities: { tools: {} },
          serverInfo: { name: "backchat-browser" },
        },
      });

      await expect(postJson(server.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }, "secret-token")).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: { tools: expect.arrayContaining([expect.objectContaining({ name: "browser.goto" })]) },
      });

      await expect(postJson(server.url, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "browser.new_tab", arguments: { browser: "iab" } },
      }, "secret-token")).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: "{\"id\":\"tab-1\",\"title\":\"Probe\",\"url\":\"about:blank\"}" }] },
      });
    } finally {
      await server.close();
    }
  });

  it("rejects missing bearer auth", async () => {
    const server = await createBrowserMcpHttpServer({
      service: fakeService([]),
      token: "secret-token",
    });
    try {
      const response = await fetch(server.url, {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });
});

function fakeService(calls: unknown[]): BrowserPluginService {
  let sessionName: string | null = null;
  return {
    onEvent() {
      return () => {};
    },
    async listBrowsers() {
      calls.push(["listBrowsers"]);
      return [{
        id: "backchat-iab",
        type: "iab",
        name: "Backchat In-app Browser",
        capabilities: { browser: [], tab: [] },
      }];
    },
    async getBrowser(ref) {
      calls.push(["getBrowser", ref]);
      return {
        id: ref,
        type: "iab",
        name: "Backchat In-app Browser",
        capabilities: { browser: [], tab: [] },
      };
    },
    async listTabs(browser) {
      calls.push(["listTabs", browser]);
      return [{ id: "tab-1", title: "Probe", url: "about:blank" }];
    },
    async selectedTab(browser) {
      calls.push(["selectedTab", browser]);
      return { id: "tab-1", title: "Probe", url: "about:blank" };
    },
    async userOpenTabs(browser) {
      calls.push(["userOpenTabs", browser]);
      return [{ id: "chrome-1", title: "Chrome Docs", url: "https://example.com/docs" }];
    },
    async getTab(params) {
      calls.push(["getTab", params]);
      return { id: params.tabId, title: "Probe", url: "about:blank" };
    },
    async nameSession(params) {
      calls.push(["nameSession", params]);
      sessionName = params.name;
      return { browser: params.browser, name: params.name };
    },
    async getSessionName(browser) {
      calls.push(["getSessionName", browser]);
      return sessionName;
    },
    async selectTab(params) {
      calls.push(["selectTab", params]);
      return { id: params.tabId, title: "Probe", url: "about:blank" };
    },
    async newTab(browser) {
      calls.push(["newTab", browser]);
      return { id: "tab-1", title: "Probe", url: "about:blank" };
    },
    async goto(params) {
      calls.push(["goto", params]);
      return { id: params.tabId, title: "Probe", url: params.url };
    },
    async reload(params) {
      calls.push(["reload", params]);
      return { id: params.tabId, title: "Probe", url: "http://127.0.0.1:5173/" };
    },
    async back(params) {
      calls.push(["back", params]);
      return { id: params.tabId, title: "Probe", url: "http://127.0.0.1:5173/" };
    },
    async forward(params) {
      calls.push(["forward", params]);
      return { id: params.tabId, title: "Probe", url: "http://127.0.0.1:5173/" };
    },
    async waitForURL(params) {
      calls.push(["waitForURL", params]);
      return { id: params.tabId, title: "Probe", url: params.url };
    },
    async waitForLoadState(params) {
      calls.push(["waitForLoadState", params]);
      return { id: params.tabId, title: "Probe", url: "http://127.0.0.1:5173/" };
    },
    async title(params) {
      calls.push(["title", params]);
      return "Probe";
    },
    async url(params) {
      calls.push(["url", params]);
      return "http://127.0.0.1:5173/";
    },
    async closeTab(params) {
      calls.push(["closeTab", params]);
    },
    async screenshot(params) {
      calls.push(["screenshot", params]);
      return { bytes: Uint8Array.from([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };
    },
    async setViewport(browser, size) {
      calls.push(["setViewport", browser, size]);
    },
    async resetViewport(browser) {
      calls.push(["resetViewport", browser]);
    },
    async setVisibility(browser, visible) {
      calls.push(["setVisibility", browser, visible]);
    },
    async getVisibility(browser) {
      calls.push(["getVisibility", browser]);
      return true;
    },
    async attachView(params) {
      calls.push(["attachView", params]);
    },
    async detachView(params) {
      calls.push(["detachView", params]);
    },
    async devLogs(params) {
      calls.push(["devLogs", params]);
      return [{ level: "log", message: "clicked-log", timestamp: "2026-07-02T00:00:00.000Z", url: params.pageUrl }];
    },
    async domSnapshot(params) {
      calls.push(["domSnapshot", params]);
      return "Ping\nName";
    },
    async evaluate(params) {
      calls.push(["evaluate", params]);
      return "Probe";
    },
    async click(params) {
      calls.push(["click", params]);
    },
    async type(params) {
      calls.push(["type", params]);
    },
    async press(params) {
      calls.push(["press", params]);
    },
    async cuaClick(params) {
      calls.push(["cuaClick", params]);
    },
    async domCuaSnapshot(params) {
      calls.push(["domCuaSnapshot", params]);
      return '<button node_id="1">Ping</button>';
    },
    async domCuaClick(params) {
      calls.push(["domCuaClick", params]);
    },
    async locatorCount(params) {
      calls.push(["locatorCount", params]);
      return 2;
    },
    async locatorClick(params) {
      calls.push(["locatorClick", params]);
    },
    async locatorFill(params) {
      calls.push(["locatorFill", params]);
    },
    async locatorPress(params) {
      calls.push(["locatorPress", params]);
    },
    async locatorSetChecked(params) {
      calls.push(["locatorSetChecked", params]);
    },
    async locatorSelectOption(params) {
      calls.push(["locatorSelectOption", params]);
    },
    async locatorInnerText(params) {
      calls.push(["locatorInnerText", params]);
      return "Submit";
    },
    async locatorAttribute(params) {
      calls.push(["locatorAttribute", params]);
      return "ready";
    },
    async getDialog(params) {
      calls.push(["getDialog", params]);
      return { type: "confirm", message: "Proceed?" };
    },
    async acceptDialog(params) {
      calls.push(["acceptDialog", params]);
    },
    async dismissDialog(params) {
      calls.push(["dismissDialog", params]);
    },
    async pageAssets(params) {
      calls.push(["pageAssets", params]);
      return [{ url: "http://127.0.0.1:5173/app.js", type: "script" }];
    },
    async bundleAssets(params) {
      calls.push(["bundleAssets", params]);
      return {
        directory: "/tmp/backchat-browser-assets",
        manifestPath: "/tmp/backchat-browser-assets/manifest.json",
        assets: [{ url: "http://127.0.0.1:5173/app.js", type: "script", status: "saved" }],
      };
    },
    async clipboardReadText() {
      calls.push(["clipboardReadText"]);
      return "clipboard text";
    },
    async clipboardWriteText(text) {
      calls.push(["clipboardWriteText", text]);
    },
  };
}

async function postJson(url: string, body: unknown, token: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json();
}
