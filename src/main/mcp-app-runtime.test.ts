import { describe, expect, it } from "vitest";
import {
  MCP_APP_EXTENSION_ID,
  MCP_APP_MIME_TYPE,
  buildMcpAppClientCapabilities,
  findMcpAppTool,
} from "./mcp-app-runtime.js";

describe("MCP App extension discovery", () => {
  it("advertises the official UI extension during initialize", () => {
    expect(buildMcpAppClientCapabilities()).toEqual({
      extensions: {
        [MCP_APP_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
      },
    });
  });

  it("matches an ACP namespaced tool and reads nested UI metadata", () => {
    const match = findMcpAppTool("mcp__charts__show_sales", [
      { name: "plain", inputSchema: { type: "object" }, _meta: {} },
      {
        name: "show_sales",
        title: "Show sales",
        inputSchema: { type: "object" },
        _meta: { ui: { resourceUri: "ui://charts/sales.html" } },
      },
    ]);

    expect(match).toMatchObject({
      name: "show_sales",
      resourceUri: "ui://charts/sales.html",
    });
  });

  it("rejects non-ui resources and ambiguous suffix matches", () => {
    expect(findMcpAppTool("show", [
      { name: "one_show", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://one" } } },
      { name: "two_show", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://two" } } },
      { name: "show", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "https://example.com" } } },
    ])).toBeUndefined();
  });
});
