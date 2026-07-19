import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, readdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ACP_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

interface AcpRegistryNpxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

interface AcpRegistryUvxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

interface AcpRegistryTargetConfig {
  archive: string;
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
  sha256?: string;
}

export interface AcpRegistryAgent {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  website?: string;
  repository?: string;
  distribution?: {
    binary?: Record<string, AcpRegistryTargetConfig>;
    npx?: AcpRegistryNpxDistribution;
    uvx?: AcpRegistryUvxDistribution;
  };
}

interface AcpRegistryResponse {
  agents?: AcpRegistryAgent[];
}

export interface InstallAcpRegistryAgentOptions {
  registryId: string;
  registryAgent?: AcpRegistryAgent;
  shimName: string;
  binDir: string;
  fetchImpl?: typeof fetch;
  npmCommand?: string;
  installRoot?: string;
  shimArgs?: string[];
  shimEnv?: Record<string, string | undefined>;
  env?: NodeJS.ProcessEnv;
}

export interface AcpRegistryCatalogAgent {
  id: string;
  name: string;
  version?: string;
  description?: string;
  homepage?: string;
  installable: boolean;
  args?: string[];
  env?: Record<string, string>;
}

export interface InstallManagedAdapterOptions {
  id: string;
  label: string;
  command: string;
  args?: string[];
  downloadUrl: string;
  binDir: string;
  fetchImpl?: typeof fetch;
}

export interface InstallResult {
  commandPath: string;
}

export interface AcpRegistryInstallMetadata {
  source: "registry";
  registryId: string;
  shimName: string;
  version?: string;
  installedAt: string;
}

export interface UninstallAcpRegistryAgentOptions {
  registryId: string;
  shimName: string;
  binDir: string;
  installRoot?: string;
}

export interface UninstallManagedAdapterOptions {
  command: string;
  binDir: string;
}

function currentPlatformKey(): string {
  const os = process.platform === "darwin"
    ? "darwin"
    : process.platform === "linux"
      ? "linux"
      : process.platform === "win32"
        ? "windows"
        : process.platform;
  const arch = process.arch === "arm64"
    ? "aarch64"
    : process.arch === "x64"
      ? "x86_64"
      : process.arch;
  return `${os}-${arch}`;
}

function currentDistribution(agent: AcpRegistryAgent): {
  args?: string[];
  env?: Record<string, string>;
  installable: boolean;
} {
  const target = agent.distribution?.binary?.[currentPlatformKey()];
  if (target) {
    return {
      installable: true,
      ...(target.args && target.args.length > 0 ? { args: target.args } : {}),
      ...(target.env && Object.keys(target.env).length > 0 ? { env: target.env } : {}),
    };
  }
  if (agent.distribution?.npx) {
    return {
      installable: true,
      ...(agent.distribution.npx.args && agent.distribution.npx.args.length > 0 ? { args: agent.distribution.npx.args } : {}),
      ...(agent.distribution.npx.env && Object.keys(agent.distribution.npx.env).length > 0 ? { env: agent.distribution.npx.env } : {}),
    };
  }
  if (agent.distribution?.uvx) {
    return {
      installable: true,
      ...(agent.distribution.uvx.args && agent.distribution.uvx.args.length > 0 ? { args: agent.distribution.uvx.args } : {}),
      ...(agent.distribution.uvx.env && Object.keys(agent.distribution.uvx.env).length > 0 ? { env: agent.distribution.uvx.env } : {}),
    };
  }
  return { installable: false };
}

function sanitizePathComponent(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized.length > 0 ? sanitized : "unknown";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellEnvExports(env: Record<string, string | undefined>): string[] {
  return Object.entries(env).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Registry env key is not shell-safe: ${key}`);
    }
    return [`export ${key}=${shellQuote(value)}`];
  });
}

function renderShellShim(
  commandPath: string,
  args: string[] = [],
  env: Record<string, string | undefined> = {},
): string {
  return [
    "#!/bin/sh",
    "set -eu",
    ...shellEnvExports(env),
    `exec ${shellQuote(commandPath)}${args.length > 0 ? ` ${args.map(shellQuote).join(" ")}` : ""} "$@"`,
    "",
  ].join("\n");
}

async function writeExecutableShim(
  shimPath: string,
  commandPath: string,
  args: string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<void> {
  await mkdir(dirname(shimPath), { recursive: true });
  const stagedPath = `${shimPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(stagedPath, renderShellShim(commandPath, args, env), "utf8");
  await chmod(stagedPath, 0o755);
  await rename(stagedPath, shimPath);
}

async function fetchBytes(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Install download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchRegistry(fetchImpl: typeof fetch): Promise<AcpRegistryResponse> {
  const response = await fetchImpl(ACP_REGISTRY_URL);
  if (!response.ok) throw new Error(`ACP registry unavailable: HTTP ${response.status}`);
  return await response.json() as AcpRegistryResponse;
}

export async function listAcpRegistryCatalog(
  options: { fetchImpl?: typeof fetch } = {},
): Promise<AcpRegistryCatalogAgent[]> {
  const registry = await fetchRegistry(options.fetchImpl ?? fetch);
  return (registry.agents ?? [])
    .filter((agent) => typeof agent.id === "string" && agent.id.length > 0)
    .map((agent) => {
      const distribution = currentDistribution(agent);
      return {
        id: agent.id,
        name: agent.name ?? agent.id,
        ...(agent.version ? { version: agent.version } : {}),
        ...(agent.description ? { description: agent.description } : {}),
        ...(agent.website ?? agent.repository ? { homepage: agent.website ?? agent.repository } : {}),
        installable: distribution.installable,
        ...(distribution.args ? { args: distribution.args } : {}),
        ...(distribution.env ? { env: distribution.env } : {}),
      };
    });
}

function assertSafeRelativeCommand(cmd: string): string {
  if (isAbsolute(cmd)) throw new Error(`Registry command must be relative: ${cmd}`);
  const normalized = cmd.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) throw new Error(`Registry command cannot contain '..': ${cmd}`);
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function archiveKind(url: string): "zip" | "tar-gz" | "tar-bz2" | "raw" {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (path.endsWith(".zip")) return "zip";
  if (path.endsWith(".tar.gz") || path.endsWith(".tgz")) return "tar-gz";
  if (path.endsWith(".tar.bz2") || path.endsWith(".tbz2")) return "tar-bz2";
  return "raw";
}

function rawBinaryFileName(url: string): string {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const name = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(`Cannot determine binary file name from ${url}`);
  }
  return name;
}

function versionedInstallDir(root: string, registryId: string, version: string | undefined, archiveUrl: string): string {
  const versionLabel = sanitizePathComponent(version ?? "unknown");
  const hash = createHash("sha256").update(`${version ?? ""}\0${archiveUrl}`).digest("hex").slice(0, 16);
  return join(root, "registry", sanitizePathComponent(registryId), `v_${versionLabel}_${hash}`);
}

function registryInstallMetadataPath(root: string, registryId: string): string {
  return join(root, "registry", sanitizePathComponent(registryId), "install.json");
}

async function writeRegistryInstallMetadata(
  options: Required<Pick<InstallAcpRegistryAgentOptions, "registryId" | "shimName">> &
    Pick<InstallAcpRegistryAgentOptions, "binDir" | "installRoot">,
  metadata: AcpRegistryInstallMetadata,
): Promise<void> {
  const installRoot = options.installRoot ?? options.binDir;
  if (!installRoot) throw new Error("Install metadata requires an install root");
  const metadataPath = registryInstallMetadataPath(installRoot, options.registryId);
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
}

export async function readAcpRegistryInstallMetadata(options: {
  registryId: string;
  binDir: string;
  installRoot?: string;
}): Promise<AcpRegistryInstallMetadata | null> {
  const installRoot = options.installRoot ?? options.binDir;
  try {
    const parsed = JSON.parse(await readFile(registryInstallMetadataPath(installRoot, options.registryId), "utf8")) as Partial<AcpRegistryInstallMetadata>;
    if (parsed.source !== "registry" || parsed.registryId !== options.registryId || typeof parsed.shimName !== "string") {
      return null;
    }
    return {
      source: "registry",
      registryId: parsed.registryId,
      shimName: parsed.shimName,
      ...(typeof parsed.version === "string" && parsed.version.length > 0 ? { version: parsed.version } : {}),
      installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : "",
    };
  } catch {
    return null;
  }
}

function verifySha256(bytes: Buffer, expected: string | undefined): void {
  if (!expected) return;
  const normalized = expected.startsWith("sha256:") ? expected.slice("sha256:".length) : expected;
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual.toLowerCase() !== normalized.toLowerCase()) {
    throw new Error(`ACP registry archive checksum mismatch: expected ${normalized}, got ${actual}`);
  }
}

async function installBinaryDistribution(
  agent: AcpRegistryAgent,
  target: AcpRegistryTargetConfig,
  options: Required<Pick<InstallAcpRegistryAgentOptions, "binDir" | "registryId" | "shimName">> &
    Pick<InstallAcpRegistryAgentOptions, "installRoot" | "fetchImpl" | "shimArgs" | "shimEnv">,
): Promise<InstallResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const installRoot = options.installRoot ?? options.binDir;
  const finalDir = versionedInstallDir(installRoot, options.registryId, agent.version, target.archive);
  const commandRelativePath = assertSafeRelativeCommand(target.cmd);
  const commandPath = resolve(finalDir, commandRelativePath);

  const relativeCommandPath = relative(resolve(finalDir), commandPath);
  if (relativeCommandPath.startsWith("..") || isAbsolute(relativeCommandPath)) {
    throw new Error(`Registry command escapes install directory: ${target.cmd}`);
  }

  try {
    await chmod(commandPath, 0o755);
  } catch {
    const tmpDir = `${finalDir}.tmp-${process.pid}-${Date.now()}`;
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    const bytes = await fetchBytes(target.archive, fetchImpl);
    verifySha256(bytes, target.sha256);
    const kind = archiveKind(target.archive);
    const archivePath = join(tmpDir, `download${kind === "zip" ? ".zip" : kind === "tar-gz" ? ".tar.gz" : kind === "tar-bz2" ? ".tar.bz2" : extname(rawBinaryFileName(target.archive))}`);

    if (kind === "raw") {
      await writeFile(join(tmpDir, rawBinaryFileName(target.archive)), bytes);
    } else {
      await writeFile(archivePath, bytes);
      if (kind === "zip") {
        await execFileAsync("unzip", ["-q", archivePath, "-d", tmpDir]);
      } else if (kind === "tar-gz") {
        await execFileAsync("tar", ["-xzf", archivePath, "-C", tmpDir]);
      } else {
        await execFileAsync("tar", ["-xjf", archivePath, "-C", tmpDir]);
      }
      await rm(archivePath, { force: true });
    }

    await rm(finalDir, { recursive: true, force: true });
    await mkdir(dirname(finalDir), { recursive: true });
    await rename(tmpDir, finalDir);
    await chmod(commandPath, 0o755);
  }

  const shimPath = join(options.binDir, options.shimName);
  await writeExecutableShim(shimPath, commandPath, options.shimArgs ?? target.args ?? [], {
    ...(target.env ?? {}),
    ...(options.shimEnv ?? {}),
  });
  return { commandPath: shimPath };
}

function packageNameFromSpec(packageSpec: string): string {
  if (packageSpec.startsWith("@")) {
    const versionIndex = packageSpec.indexOf("@", 1);
    return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
  }
  const versionIndex = packageSpec.lastIndexOf("@");
  return versionIndex > 0 ? packageSpec.slice(0, versionIndex) : packageSpec;
}

function packagePathParts(packageName: string): string[] {
  return packageName.split("/").filter(Boolean);
}

function isNpmTargetMissing(error: unknown): boolean {
  const stderr = typeof error === "object" && error !== null && "stderr" in error
    ? String((error as { stderr?: unknown }).stderr ?? "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return /\bETARGET\b|No matching version found/i.test(`${message}\n${stderr}`);
}

async function resolvePackageBin(prefixDir: string, packageSpec: string): Promise<string> {
  const packageName = packageNameFromSpec(packageSpec);
  const packageJsonPath = join(prefixDir, "node_modules", ...packagePathParts(packageName), "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const unscopedName = basename(packageName);
  const binName = typeof pkg.bin === "string"
    ? unscopedName
    : pkg.bin?.[unscopedName]
      ? unscopedName
      : Object.keys(pkg.bin ?? {})[0];
  if (!binName) throw new Error(`${packageSpec} does not expose an executable bin`);
  return join(prefixDir, "node_modules", ".bin", process.platform === "win32" ? `${binName}.cmd` : binName);
}

async function installNpxDistribution(
  npx: AcpRegistryNpxDistribution,
  options: Required<Pick<InstallAcpRegistryAgentOptions, "binDir" | "registryId" | "shimName">> &
    Pick<InstallAcpRegistryAgentOptions, "installRoot" | "npmCommand" | "env" | "shimArgs" | "shimEnv"> &
    { version?: string },
): Promise<InstallResult> {
  const installRoot = options.installRoot ?? options.binDir;
  const prefixDir = versionedInstallDir(
    installRoot,
    options.registryId,
    options.version,
    `npx:${npx.package}`,
  );
  let packageBin: string;
  try {
    packageBin = await resolvePackageBin(prefixDir, npx.package);
    await access(packageBin);
  } catch {
    const stagedDir = `${prefixDir}.tmp-${process.pid}-${Date.now()}`;
    await rm(stagedDir, { recursive: true, force: true });
    try {
      const npmOptions = {
        env: {
          ...process.env,
          ...(options.env ?? {}),
        },
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      };
      const installArgs = [
        "install",
        "--prefix",
        stagedDir,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
      ];
      try {
        await execFileAsync(
          options.npmCommand ?? "npm",
          [...installArgs, "--prefer-offline", npx.package],
          npmOptions,
        );
      } catch (error) {
        if (!isNpmTargetMissing(error)) throw error;
        await rm(stagedDir, { recursive: true, force: true });
        await execFileAsync(
          options.npmCommand ?? "npm",
          [...installArgs, "--prefer-online", npx.package],
          npmOptions,
        );
      }
      const stagedBin = await resolvePackageBin(stagedDir, npx.package);
      await access(stagedBin);
      await rm(prefixDir, { recursive: true, force: true });
      await mkdir(dirname(prefixDir), { recursive: true });
      await rename(stagedDir, prefixDir);
    } catch (error) {
      await rm(stagedDir, { recursive: true, force: true });
      throw error;
    }
    packageBin = await resolvePackageBin(prefixDir, npx.package);
  }

  const shimPath = join(options.binDir, options.shimName);
  await writeExecutableShim(shimPath, packageBin, options.shimArgs ?? npx.args ?? [], {
    ...(npx.env ?? {}),
    ...(options.shimEnv ?? {}),
  });
  return { commandPath: shimPath };
}

async function installUvxDistribution(
  uvx: AcpRegistryUvxDistribution,
  options: Required<Pick<InstallAcpRegistryAgentOptions, "binDir" | "registryId" | "shimName">> &
    Pick<InstallAcpRegistryAgentOptions, "installRoot" | "env" | "shimArgs" | "shimEnv">,
): Promise<InstallResult> {
  const installRoot = options.installRoot ?? options.binDir;
  const prefixDir = join(installRoot, "registry", sanitizePathComponent(options.registryId), "uvx");
  const toolDir = join(prefixDir, "tools");
  const toolBinDir = join(prefixDir, "bin");
  await mkdir(toolBinDir, { recursive: true });

  await execFileAsync(
    "uv",
    ["tool", "install", "--force", uvx.package],
    {
      env: {
        ...process.env,
        ...(options.env ?? {}),
        UV_TOOL_DIR: toolDir,
        UV_TOOL_BIN_DIR: toolBinDir,
      },
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    },
  );

  const packageBin = await firstExecutableInDir(toolBinDir, pythonPackageNameFromSpec(uvx.package));
  const shimPath = join(options.binDir, options.shimName);
  await writeExecutableShim(shimPath, packageBin, options.shimArgs ?? uvx.args ?? [], {
    ...(uvx.env ?? {}),
    ...(options.shimEnv ?? {}),
  });
  return { commandPath: shimPath };
}

function pythonPackageNameFromSpec(packageSpec: string): string {
  return (packageSpec
    .split(/[<>=!~\[]/, 1)[0]
    ?? packageSpec)
    .trim()
    .replace(/_/g, "-");
}

async function firstExecutableInDir(binDir: string, preferredName: string): Promise<string> {
  const entries: string[] = await readdir(binDir).catch(() => []);
  const preferred = [
    preferredName,
    preferredName.replace(/-/g, "_"),
    basename(preferredName),
  ];
  for (const name of [...preferred, ...entries]) {
    if (!entries.includes(name)) continue;
    const candidate = join(binDir, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep looking; uv may create several helper files depending on platform.
    }
  }
  throw new Error(`uv did not expose an executable for ${preferredName}`);
}

export async function installAcpRegistryAgent(options: InstallAcpRegistryAgentOptions): Promise<InstallResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const registry = options.registryAgent ? null : await fetchRegistry(fetchImpl);
  const agent = options.registryAgent ?? registry?.agents?.find((candidate) => candidate.id === options.registryId);
  if (!agent) throw new Error(`ACP registry agent not found: ${options.registryId}`);
  if (agent.id !== options.registryId) {
    throw new Error(`ACP registry snapshot mismatch: expected ${options.registryId}, got ${agent.id}`);
  }

  const platformKey = currentPlatformKey();
  const target = agent.distribution?.binary?.[platformKey];
  let result: InstallResult;
  if (target) {
    result = await installBinaryDistribution(agent, target, {
      registryId: options.registryId,
      shimName: options.shimName,
      binDir: options.binDir,
      installRoot: options.installRoot,
      fetchImpl,
      shimArgs: options.shimArgs,
      shimEnv: options.shimEnv,
    });
  } else if (agent.distribution?.npx) {
    result = await installNpxDistribution(agent.distribution.npx, {
      registryId: options.registryId,
      shimName: options.shimName,
      binDir: options.binDir,
      installRoot: options.installRoot,
      npmCommand: options.npmCommand,
      env: options.env,
      shimArgs: options.shimArgs,
      shimEnv: options.shimEnv,
      version: agent.version,
    });
  } else if (agent.distribution?.uvx) {
    result = await installUvxDistribution(agent.distribution.uvx, {
      registryId: options.registryId,
      shimName: options.shimName,
      binDir: options.binDir,
      installRoot: options.installRoot,
      env: options.env,
      shimArgs: options.shimArgs,
      shimEnv: options.shimEnv,
    });
  } else {
    throw new Error(`${agent.name ?? agent.id} has no registry install for ${platformKey}`);
  }

  await writeRegistryInstallMetadata(options, {
    source: "registry",
    registryId: options.registryId,
    shimName: options.shimName,
    ...(agent.version ? { version: agent.version } : {}),
    installedAt: new Date().toISOString(),
  });
  return result;
}

export async function installManagedAdapter(options: InstallManagedAdapterOptions): Promise<InstallResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const bytes = await fetchBytes(options.downloadUrl, fetchImpl);
  await mkdir(options.binDir, { recursive: true });
  const commandPath = join(options.binDir, basename(options.command));
  await writeFile(commandPath, bytes);
  await chmod(commandPath, 0o755);
  return { commandPath };
}

export async function uninstallAcpRegistryAgent(options: UninstallAcpRegistryAgentOptions): Promise<void> {
  const installRoot = options.installRoot ?? options.binDir;
  await rm(join(options.binDir, options.shimName), { force: true });
  await rm(join(installRoot, "registry", sanitizePathComponent(options.registryId)), {
    recursive: true,
    force: true,
  });
}

export async function uninstallManagedAdapter(options: UninstallManagedAdapterOptions): Promise<void> {
  await rm(join(options.binDir, basename(options.command)), { force: true });
}
