import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer content security policy", () => {
  it("allows official ACP registry icons without allowing arbitrary remote images", () => {
    const html = readFileSync(join(process.cwd(), "src/renderer/index.html"), "utf8");

    expect(html).toContain("img-src 'self' data: https://cdn.agentclientprotocol.com;");
    expect(html).not.toContain("img-src 'self' data: https:;");
  });
});
