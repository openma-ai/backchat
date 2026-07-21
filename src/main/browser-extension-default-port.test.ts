import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Chrome extension bridge default port", () => {
  it("keeps the Electron bridge default aligned with the extension worker", () => {
    const ipc = readFileSync(resolve(__dirname, "ipc.ts"), "utf8");
    const background = readFileSync(
      resolve(__dirname, "../../packages/browser-extension/background.js"),
      "utf8",
    );

    expect(ipc).toContain('BACKCHAT_BROWSER_EXTENSION_PORT"] ?? "29174"');
    expect(ipc).toContain(": 29174");
    expect(ipc).toContain("chromeExtensionBridgeMetadata");
    expect(ipc).toContain("bridgeStatus");
    expect(ipc).toContain("bridgeLastError");
    expect(background).toContain("const DEFAULT_BRIDGE_PORT = 29174");
  });
});
