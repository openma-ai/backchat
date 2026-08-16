import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface BundledNodeRuntime {
  npmCommand: string;
  npmCommandArgs: string[];
  npmEnv: Record<string, string>;
}

interface ProvisionBundledNodeRuntimeOptions {
  binDir: string;
  executablePath: string;
  npmCliPath: string;
  platform?: NodeJS.Platform;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function resolveBundledNpmCliPath(options: {
  appPath: string;
  packaged: boolean;
  resourcesPath: string;
}): string {
  const runtimeRoot = options.packaged
    ? join(options.resourcesPath, "bundled-npm-runtime.asar")
    : join(options.appPath, "packages", "bundled-npm-runtime");
  return join(runtimeRoot, "node_modules", "npm", "bin", "npm-cli.js");
}

export async function provisionBundledNodeRuntime({
  binDir,
  executablePath,
  npmCliPath,
  platform = process.platform,
}: ProvisionBundledNodeRuntimeOptions): Promise<BundledNodeRuntime> {
  await mkdir(binDir, { recursive: true });

  if (platform === "win32") {
    const nodeShim = join(binDir, "node.cmd");
    await writeFile(
      nodeShim,
      `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${cmdQuote(executablePath)} %*\r\n`,
      "utf8",
    );
  } else {
    const nodeShim = join(binDir, "node");
    await writeFile(
      nodeShim,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(executablePath)} "$@"\n`,
      "utf8",
    );
    await chmod(nodeShim, 0o755);
  }

  return {
    npmCommand: executablePath,
    npmCommandArgs: [npmCliPath],
    npmEnv: { ELECTRON_RUN_AS_NODE: "1" },
  };
}
