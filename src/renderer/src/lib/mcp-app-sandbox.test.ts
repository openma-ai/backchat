import { describe, expect, it } from "vitest";
import { buildMcpAppDocument, clampMcpAppHeight } from "./mcp-app-sandbox.js";

describe("MCP App sandbox", () => {
  it("injects the resource CSP ahead of untrusted markup", () => {
    const html = buildMcpAppDocument("<html><head><title>App</title></head><body>ok</body></html>", {
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    });

    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src https://api.example.com");
    expect(html).toContain("img-src data: blob: https://cdn.example.com");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<title>App</title>"));
  });

  it("keeps app-requested height usable but bounded", () => {
    expect(clampMcpAppHeight(undefined)).toBe(360);
    expect(clampMcpAppHeight(40)).toBe(160);
    expect(clampMcpAppHeight(9000)).toBe(720);
  });
});
