import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEV_REMOTE_DEBUGGING_PORT,
  LOOPBACK_REMOTE_DEBUGGING_ADDRESS,
  resolveRemoteDebugging,
  type RemoteDebuggingInput,
} from "./remote-debugging.js";

const repoRoot = resolve(import.meta.dirname, "../..");

function productionSources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "out" || entry.name === "release") {
        return [];
      }
      return productionSources(path);
    }
    if (
      ![".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(entry.name))
      || /\.test\.[cm]?[jt]sx?$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

function decision(
  overrides: Partial<RemoteDebuggingInput> & Pick<RemoteDebuggingInput, "isPackaged" | "devBuild">,
): ReturnType<typeof resolveRemoteDebugging> {
  return resolveRemoteDebugging({
    env: {},
    ...overrides,
  });
}

describe("remote debugging port contract", () => {
  it("keeps packaged builds closed unless the opt-in port is set", () => {
    const packaged = { isPackaged: true, devBuild: false } as const;

    expect(decision({ ...packaged, env: {} })).toBeNull();
    expect(decision({
      ...packaged,
      env: { NODE_ENV: undefined },
    })).toBeNull();
    expect(decision({
      ...packaged,
      env: { NODE_ENV: "development" },
    })).toBeNull();
    expect(decision({
      ...packaged,
      devBuild: true,
      env: { NODE_ENV: "development" },
    })).toBeNull();
    expect(decision({
      ...packaged,
      env: { BACKCHAT_TEST_HOOKS: "1", NODE_ENV: "test" },
    })).toBeNull();
    expect(decision({
      ...packaged,
      env: { BACKCHAT_REMOTE_DEBUGGING_PORT: "9333" },
    })).toEqual({
      port: "9333",
      address: LOOPBACK_REMOTE_DEBUGGING_ADDRESS,
      allowOrigins: "*",
    });
    expect(decision({
      ...packaged,
      env: { BACKCHAT_REMOTE_DEBUGGING_PORT: " 9222 " },
    })?.port).toBe("9222");
    expect(decision({
      ...packaged,
      env: { BACKCHAT_REMOTE_DEBUGGING_PORT: "0.0.0.0:9222" },
    })).toBeNull();
    expect(decision({
      ...packaged,
      env: { BACKCHAT_REMOTE_DEBUGGING_PORT: "0" },
    })).toBeNull();
    expect(decision({
      ...packaged,
      env: { BACKCHAT_REMOTE_DEBUGGING_PORT: "65536" },
    })).toBeNull();
    expect(decision({
      ...packaged,
      env: { BACKCHAT_REMOTE_DEBUGGING_PORT: "9222 --inspect" },
    })).toBeNull();
  });

  it("opens the dev port only for an unpackaged dev build that Playwright is not driving", () => {
    expect(decision({ isPackaged: false, devBuild: true })).toEqual({
      port: DEV_REMOTE_DEBUGGING_PORT,
      address: LOOPBACK_REMOTE_DEBUGGING_ADDRESS,
      allowOrigins: "*",
    });
    expect(decision({
      isPackaged: false,
      devBuild: true,
      env: { NODE_ENV: "production" },
    })?.port).toBe(DEV_REMOTE_DEBUGGING_PORT);
    expect(decision({
      isPackaged: false,
      devBuild: true,
      env: { BACKCHAT_TEST_HOOKS: "1" },
    })).toBeNull();
    expect(decision({
      isPackaged: false,
      devBuild: true,
      env: { BACKCHAT_TEST_HOOKS: "1", BACKCHAT_REMOTE_DEBUGGING_PORT: "9444" },
    })?.port).toBe("9444");
    expect(decision({ isPackaged: false, devBuild: false })).toBeNull();
    expect(decision({
      isPackaged: false,
      devBuild: false,
      env: { NODE_ENV: undefined, BACKCHAT_TEST_HOOKS: "1" },
    })).toBeNull();
    expect(decision({
      isPackaged: false,
      devBuild: true,
      env: { BACKCHAT_REMOTE_DEBUGGING_PORT: "nope" },
    })).toBeNull();
  });

  it("binds every opened port to loopback", () => {
    const opened = [
      decision({ isPackaged: false, devBuild: true }),
      decision({
        isPackaged: true,
        devBuild: false,
        env: { BACKCHAT_REMOTE_DEBUGGING_PORT: "9229" },
      }),
    ];
    for (const target of opened) {
      expect(target?.address).toBe("127.0.0.1");
      expect(target?.address).not.toBe("0.0.0.0");
    }
  });

  it("enables the Chromium switches only through the dev or opt-in guard", () => {
    const main = readFileSync(resolve(repoRoot, "src/main/index.ts"), "utf8");
    const resolver = readFileSync(resolve(repoRoot, "src/main/remote-debugging.ts"), "utf8");
    const guarded = main.match(/if \(remoteDebugging\) \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(main).toContain("resolveRemoteDebugging(");
    expect(main).toContain("isPackaged: app.isPackaged");
    expect(main).toContain("devBuild: import.meta.env.DEV");
    expect(guarded).toContain('appendSwitch("remote-debugging-address", remoteDebugging.address)');
    expect(guarded).toContain('appendSwitch("remote-debugging-port", remoteDebugging.port)');
    expect(guarded).toContain('appendSwitch("remote-allow-origins", remoteDebugging.allowOrigins)');

    const unguarded = main.replace(guarded, "");
    expect(unguarded).not.toContain("remote-debugging-port");
    expect(unguarded).not.toContain("remote-debugging-address");
    expect(unguarded).not.toContain("remote-allow-origins");
    expect(main).not.toMatch(/process\.env(?:\.NODE_ENV|\[["']NODE_ENV["']\])/);
    expect(resolver).not.toMatch(/process\.env(?:\.NODE_ENV|\[["']NODE_ENV["']\])/);
    expect(resolver).toContain("isPackaged");
    expect(resolver).toContain("BACKCHAT_REMOTE_DEBUGGING_PORT");
    expect(resolver).toContain('address: LOOPBACK_REMOTE_DEBUGGING_ADDRESS');
    expect(resolver).not.toContain("0.0.0.0");

    const roots = [
      resolve(repoRoot, "src"),
      resolve(repoRoot, "packages"),
      resolve(repoRoot, "scripts"),
      resolve(repoRoot, "e2e"),
    ];
    const violations = roots
      .flatMap(productionSources)
      .filter((path) => /remote-debugging-port|remote-allow-origins|remote-debugging-address/.test(readFileSync(path, "utf8")))
      .map((path) => relative(repoRoot, path))
      .filter((path) => path !== "src/main/index.ts");
    expect(violations).toEqual([]);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      build: unknown;
    };
    expect(JSON.stringify(pkg.scripts)).not.toContain("remote-debugging");
    expect(JSON.stringify(pkg.build)).not.toContain("remote-debugging");
    const viteConfig = readFileSync(resolve(repoRoot, "electron.vite.config.ts"), "utf8");
    expect(viteConfig).not.toContain("remote-debugging");
  });
});
