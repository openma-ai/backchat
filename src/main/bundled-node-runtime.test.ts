import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  provisionBundledNodeRuntime,
  resolveBundledNodeExecutablePath,
  resolveBundledNpmCliPath,
} from "./bundled-node-runtime.js";

describe("bundled Node runtime", () => {
  it("resolves the staged npm CLI inside a packaged app", () => {
    expect(resolveBundledNpmCliPath({
      appPath: "/Applications/Backchat.app/Contents/Resources/app.asar",
      packaged: true,
      resourcesPath: "/Applications/Backchat.app/Contents/Resources",
    })).toBe(
      "/Applications/Backchat.app/Contents/Resources/bundled-npm-runtime.asar/node_modules/npm/bin/npm-cli.js",
    );
  });

  it("uses the LSUIElement helper instead of the Dock-visible main executable on packaged macOS", () => {
    expect(resolveBundledNodeExecutablePath({
      executablePath: "/Applications/Backchat.app/Contents/MacOS/Backchat",
      packaged: true,
      platform: "darwin",
    })).toBe(
      "/Applications/Backchat.app/Contents/Frameworks/Backchat Helper.app/Contents/MacOS/Backchat Helper",
    );
  });

  it("uses the resolved background executable for npm and provisions a node shim", async () => {
    const root = join(tmpdir(), `backchat-node-runtime-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    await mkdir(root, { recursive: true });

    const runtime = await provisionBundledNodeRuntime({
      binDir,
      executablePath: "/Applications/Backchat.app/Contents/Frameworks/Backchat Helper.app/Contents/MacOS/Backchat Helper",
      npmCliPath: "/Applications/Backchat Preview.app/Contents/Resources/app.asar/node_modules/npm/bin/npm-cli.js",
      platform: "darwin",
      countryCode: "CN",
    });

    expect(runtime).toMatchObject({
      npmCommand: "/Applications/Backchat.app/Contents/Frameworks/Backchat Helper.app/Contents/MacOS/Backchat Helper",
      npmCommandArgs: [
        "/Applications/Backchat Preview.app/Contents/Resources/app.asar/node_modules/npm/bin/npm-cli.js",
      ],
      npmEnv: { ELECTRON_RUN_AS_NODE: "1" },
      npmRegistryUrls: [
        "https://registry.npmmirror.com",
        "https://registry.npmjs.org",
      ],
    });
    const shim = await readFile(join(binDir, "node"), "utf8");
    expect(shim).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(shim).toContain("'/Applications/Backchat.app/Contents/Frameworks/Backchat Helper.app/Contents/MacOS/Backchat Helper'");
    expect(shim).toContain('"$@"');

    await rm(root, { recursive: true, force: true });
  });

  it("prefers the official npm registry outside mainland China", async () => {
    const root = join(tmpdir(), `backchat-node-runtime-us-${process.pid}-${Date.now()}`);
    const runtime = await provisionBundledNodeRuntime({
      binDir: join(root, "bin"),
      executablePath: "/Applications/Backchat.app/Contents/Frameworks/Backchat Helper.app/Contents/MacOS/Backchat Helper",
      npmCliPath: "/Applications/Backchat.app/Contents/Resources/bundled-npm-runtime.asar/node_modules/npm/bin/npm-cli.js",
      platform: "darwin",
      countryCode: "US",
    });

    expect(runtime.npmRegistryUrls).toEqual([
      "https://registry.npmjs.org",
      "https://registry.npmmirror.com",
    ]);
    await rm(root, { recursive: true, force: true });
  });

  it("honors a user-configured npm registry before regional fallbacks", async () => {
    const root = join(tmpdir(), `backchat-node-runtime-custom-${process.pid}-${Date.now()}`);
    const runtime = await provisionBundledNodeRuntime({
      binDir: join(root, "bin"),
      executablePath: "/Applications/Backchat.app/Contents/Frameworks/Backchat Helper.app/Contents/MacOS/Backchat Helper",
      npmCliPath: "/Applications/Backchat.app/Contents/Resources/bundled-npm-runtime.asar/node_modules/npm/bin/npm-cli.js",
      platform: "darwin",
      countryCode: "CN",
      configuredNpmRegistryUrl: "https://registry.corp.example",
    });

    expect(runtime.npmRegistryUrls).toEqual([
      "https://registry.corp.example",
      "https://registry.npmmirror.com",
      "https://registry.npmjs.org",
    ]);
    await rm(root, { recursive: true, force: true });
  });
});
