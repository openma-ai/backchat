import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  provisionBundledNodeRuntime,
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

  it("uses Backchat's executable for npm and provisions a node shim", async () => {
    const root = join(tmpdir(), `backchat-node-runtime-${process.pid}-${Date.now()}`);
    const binDir = join(root, "bin");
    await mkdir(root, { recursive: true });

    const runtime = await provisionBundledNodeRuntime({
      binDir,
      executablePath: "/Applications/Backchat Preview.app/Contents/MacOS/Backchat",
      npmCliPath: "/Applications/Backchat Preview.app/Contents/Resources/app.asar/node_modules/npm/bin/npm-cli.js",
      platform: "darwin",
    });

    expect(runtime).toMatchObject({
      npmCommand: "/Applications/Backchat Preview.app/Contents/MacOS/Backchat",
      npmCommandArgs: [
        "/Applications/Backchat Preview.app/Contents/Resources/app.asar/node_modules/npm/bin/npm-cli.js",
      ],
      npmEnv: { ELECTRON_RUN_AS_NODE: "1" },
    });
    const shim = await readFile(join(binDir, "node"), "utf8");
    expect(shim).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(shim).toContain("'/Applications/Backchat Preview.app/Contents/MacOS/Backchat'");
    expect(shim).toContain('"$@"');

    await rm(root, { recursive: true, force: true });
  });
});
