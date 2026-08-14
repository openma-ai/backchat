import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("packaged main-process runtime dependencies", () => {
  it("resolves the MCP SDK schema adapter dependency from the application root", () => {
    const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "require('node:module').createRequire(process.argv[1]).resolve('zod-to-json-schema')",
        resolve(appRoot, "package.json"),
      ],
      {
        cwd: appRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {}),
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
