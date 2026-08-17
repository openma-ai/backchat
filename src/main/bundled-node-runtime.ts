import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface BundledNodeRuntime {
  npmCommand: string;
  npmCommandArgs: string[];
  npmEnv: Record<string, string>;
  npmRegistryUrls: string[];
}

interface ProvisionBundledNodeRuntimeOptions {
  binDir: string;
  executablePath: string;
  npmCliPath: string;
  platform?: NodeJS.Platform;
  countryCode?: string;
  configuredNpmRegistryUrl?: string;
}

const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";
const MAINLAND_NPM_MIRROR = "https://registry.npmmirror.com";

function normalizeRegistryUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\/+$/, "");
  return normalized || undefined;
}

function registryUrlsForEnvironment(options: {
  countryCode?: string;
  configuredNpmRegistryUrl?: string;
}): string[] {
  const regionalOrder = options.countryCode?.toUpperCase() === "CN"
    ? [MAINLAND_NPM_MIRROR, OFFICIAL_NPM_REGISTRY]
    : [OFFICIAL_NPM_REGISTRY, MAINLAND_NPM_MIRROR];
  return [...new Set([
    normalizeRegistryUrl(options.configuredNpmRegistryUrl),
    ...regionalOrder,
  ].filter((url): url is string => Boolean(url)))];
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

export function resolveBundledNodeExecutablePath(options: {
  executablePath: string;
  packaged: boolean;
  platform?: NodeJS.Platform;
}): string {
  if (!options.packaged || (options.platform ?? process.platform) !== "darwin") {
    return options.executablePath;
  }
  const executableName = basename(options.executablePath);
  const contentsDir = dirname(dirname(options.executablePath));
  const helperName = `${executableName} Helper`;
  return join(
    contentsDir,
    "Frameworks",
    `${helperName}.app`,
    "Contents",
    "MacOS",
    helperName,
  );
}

export async function provisionBundledNodeRuntime({
  binDir,
  executablePath,
  npmCliPath,
  platform = process.platform,
  countryCode,
  configuredNpmRegistryUrl,
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
    npmRegistryUrls: registryUrlsForEnvironment({
      countryCode,
      configuredNpmRegistryUrl,
    }),
  };
}
