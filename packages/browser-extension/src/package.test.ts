import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createBrowserExtensionPackage,
  listStoredZipEntries,
} from "./package.js";

describe("package browser extension", () => {
  it("creates a Chrome-installable zip and audited install manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-extension-package-"));
    const extensionDir = join(root, "extension");
    const outputDir = join(root, "dist");
    await mkdir(extensionDir, { recursive: true });
    await Promise.all([
      writeFile(join(extensionDir, "manifest.json"), JSON.stringify({
        manifest_version: 3,
        name: "Backchat Browser Bridge",
        version: "0.1.0",
        background: { service_worker: "background.js", type: "module" },
        action: { default_popup: "popup.html" },
      }), "utf8"),
      writeFile(join(extensionDir, "background.js"), "globalThis.bridge = true;\n", "utf8"),
      writeFile(join(extensionDir, "popup.html"), "<link rel=\"stylesheet\" href=\"popup.css\"><script src=\"popup.js\"></script>", "utf8"),
      writeFile(join(extensionDir, "popup.css"), "body { margin: 0; }\n", "utf8"),
      writeFile(join(extensionDir, "popup.js"), "globalThis.popup = true;\n", "utf8"),
    ]);

    const result = await createBrowserExtensionPackage({
      extensionDir,
      outputDir,
      generatedAt: "2026-07-04T00:00:00.000Z",
    });

    expect(result.zipPath).toBe(join(outputDir, "backchat-browser-extension-0.1.0.zip"));
    expect(result.installManifestPath).toBe(join(outputDir, "browser-extension-install.json"));
    const zipBytes = await readFile(result.zipPath);
    expect([...zipBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(listStoredZipEntries(zipBytes)).toEqual([
      "manifest.json",
      "background.js",
      "popup.html",
      "popup.css",
      "popup.js",
    ]);
    await expect(readFile(result.installManifestPath, "utf8").then(JSON.parse))
      .resolves.toEqual({
        generatedAt: "2026-07-04T00:00:00.000Z",
        installMode: "chrome-extension-zip",
        extensionName: "Backchat Browser Bridge",
        extensionVersion: "0.1.0",
        packageFile: "backchat-browser-extension-0.1.0.zip",
        sourceDirectory: extensionDir,
        files: [
          "manifest.json",
          "background.js",
          "popup.html",
          "popup.css",
          "popup.js",
        ],
        installSteps: [
          "Open chrome://extensions",
          "Enable Developer mode",
          "Drag the zip into Chrome or unzip it and Load unpacked from the extracted directory",
          "Open Backchat Settings > Browser and confirm the bridge status is connected",
        ],
      });
  });
});
