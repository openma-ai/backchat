import { describe, expect, it } from "vitest";
import {
  registerMcpAppDocument,
  resolveMcpAppDocument,
  resolveSandboxResource,
} from "./mcp-app-document-store.js";

describe("MCP App document store", () => {
  it("serves a sandbox document only through its opaque host URL", () => {
    const url = registerMcpAppDocument("<main>App</main>", {
      connectDomains: ["https://api.example.com"],
    });

    expect(url).toMatch(/^oma-mcp-app:\/\/view\/[0-9a-f-]+$/);
    expect(resolveMcpAppDocument(url)).toContain("Content-Security-Policy");
    expect(resolveMcpAppDocument(url)).toContain("https://api.example.com");
    expect(resolveMcpAppDocument(url.replace("view", "other"))).toBeUndefined();
    expect(resolveMcpAppDocument(`${url}/nested`)).toBeUndefined();
  });

  it("serves the pinned offline Lucide runtime to sandboxed generative UI", () => {
    const resource = resolveSandboxResource(
      "oma-mcp-app://view/__assets/lucide@1.17.0.js",
    );
    expect(resource?.contentType).toBe("text/javascript; charset=utf-8");
    expect(resource?.body).toContain("createIcons");
  });
});
