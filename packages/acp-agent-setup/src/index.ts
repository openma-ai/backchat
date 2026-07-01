import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";
import {
  detectEntry,
  getKnownAgents,
  loadRegistry,
  type KnownAgentEntry,
  type ResolveAgentCommandOptions,
} from "@open-managed-agents-desktop/acp/registry";
import {
  installAcpRegistryAgent,
  installManagedAdapter,
  readAcpRegistryInstallMetadata,
  uninstallAcpRegistryAgent,
  uninstallManagedAdapter,
} from "@open-managed-agents-desktop/acp/installer";
import {
  authenticateAgent,
  probeAgentConfigOptions,
  probeAgentAuthStatus,
  type AuthenticateAgentResult,
  type TerminalAuthLaunchOptions,
} from "@open-managed-agents-desktop/acp/probe";

export type { TerminalAuthLaunchOptions } from "@open-managed-agents-desktop/acp/probe";

export interface AcpAgentSetupAuthMethod {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  vars?: Array<{
    name: string;
    label?: string;
    secret?: boolean;
    optional?: boolean;
  }>;
  link?: string;
}

export interface AcpAgentSetupAuth {
  status: "configured" | "needs-auth" | "unknown";
  message: string;
  methodId?: string;
  methodName?: string;
  methods?: AcpAgentSetupAuthMethod[];
}

export interface AcpAgentSetupInfo {
  id: string;
  label: string;
  command: string;
  installHint?: string;
  homepage?: string;
  featured?: boolean;
  detected: boolean;
  available?: boolean;
  installed?: boolean;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  installable?: boolean;
  installSource?: "registry" | "adapter";
  custom?: boolean;
  auth?: AcpAgentSetupAuth;
  config_options?: unknown[];
}

export interface AcpAgentSetupOverride {
  id: string;
  label?: string;
  command?: string;
  args?: readonly string[];
  env?: Record<string, string | undefined> | ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

export interface AcpAgentSetupServiceDeps {
  registryCachePath: string;
  acpBinDir: string;
  acpInstallRoot: string;
  probeCwd?: string;
  probeTimeoutMs?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  refreshRegistry?: (opts: { refresh?: boolean }) => Promise<void>;
  launchInteractiveAuth?: (options: TerminalAuthLaunchOptions) => Promise<void>;
  agentOverrides?: () => readonly AcpAgentSetupOverride[];
  getDefaultAgentId?: () => string;
  saveDefaultAgentId?: (id: string) => Promise<void>;
  managedByName?: string;
}

export interface AcpAgentListOptions {
  probeAuth?: boolean;
  probeConfigOptions?: boolean;
  refresh?: boolean;
  probeAgentId?: string;
  probeConfigAgentId?: string;
}

export interface AcpAgentSetupService {
  warmup(): Promise<void>;
  listAgents(options?: AcpAgentListOptions): Promise<AcpAgentSetupInfo[]>;
  probeAgent(id: string): Promise<AcpAgentSetupInfo[]>;
  installAgent(id: string): Promise<AcpAgentSetupInfo[]>;
  upgradeAgent(id: string): Promise<AcpAgentSetupInfo[]>;
  uninstallAgent(id: string): Promise<AcpAgentSetupInfo[]>;
  authenticateAgent(id: string, options?: { methodId?: string }): Promise<AcpAgentSetupInfo[]>;
  setDefaultAgent(id: string): Promise<AcpAgentSetupInfo[]>;
}

export function createAcpAgentSetupService(deps: AcpAgentSetupServiceDeps): AcpAgentSetupService {
  return new AcpAgentSetupServiceImpl(deps);
}

class AcpAgentSetupServiceImpl implements AcpAgentSetupService {
  constructor(private readonly deps: AcpAgentSetupServiceDeps) {}

  async warmup(): Promise<void> {
    await this.listAgents({ probeAuth: true, refresh: true });
  }

  async listAgents(options: AcpAgentListOptions = {}): Promise<AcpAgentSetupInfo[]> {
    await this.refreshRegistry(options);
    const entries = this.catalogEntries();
    const detected = (await Promise.all(entries.map((entry) => detectEntry(entry, this.resolveOptions()))))
      .filter((entry): entry is SetupAgentEntry => entry !== null);
    const detectedById = new Map(detected.map((agent) => [agent.id, agent]));

    return Promise.all(entries.map(async (entry) => {
      const detectedEntry = detectedById.get(entry.id);
      const auth = detectedEntry && (options.probeAuth || options.probeAgentId === entry.id)
        ? await this.probeAuth(detectedEntry).catch(() => undefined)
        : undefined;
      const configOptions = detectedEntry &&
        (options.probeConfigOptions || options.probeConfigAgentId === entry.id) &&
        !(auth && authBlocksDefault(auth))
        ? await this.probeConfigOptions(detectedEntry).catch(() => undefined)
        : undefined;
      const installInfo = await this.managedInstallInfo(entry);
      return {
        id: entry.id,
        label: entry.label,
        command: detectedEntry?.spec.command ?? entry.spec.command,
        installHint: entry.installHint,
        homepage: entry.homepage,
        featured: entry.featured,
        detected: !!detectedEntry,
        available: !!detectedEntry,
        installed: installInfo.installed,
        ...(installInfo.installedVersion ? { installedVersion: installInfo.installedVersion } : {}),
        ...(installInfo.latestVersion ? { latestVersion: installInfo.latestVersion } : {}),
        ...(installInfo.updateAvailable ? { updateAvailable: true } : {}),
        installable: !entry.custom && Boolean(entry.installSource || entry.downloadUrl || entry.install),
        ...(entry.installSource ? { installSource: entry.installSource } : {}),
        ...(entry.custom ? { custom: true } : {}),
        ...(auth ? { auth } : {}),
        ...(configOptions ?? entry.configOptions ? { config_options: configOptions ?? entry.configOptions } : {}),
      } satisfies AcpAgentSetupInfo;
    }));
  }

  async probeAgent(id: string): Promise<AcpAgentSetupInfo[]> {
    await this.refreshRegistry({ refresh: false });
    if (!this.catalogEntries().some((candidate) => candidate.id === id)) {
      throw new Error(`Unknown ACP agent: ${id}`);
    }
    return this.listAgents({ probeAgentId: id });
  }

  async installAgent(id: string): Promise<AcpAgentSetupInfo[]> {
    await this.refreshRegistry({ refresh: true });
    const entry = this.requireEntry(id);
    if (entry.installSource === "registry") {
      if (!entry.registryId) throw new Error(`${entry.label} is missing an ACP registry id`);
      await installAcpRegistryAgent({
        registryId: entry.registryId,
        shimName: basename(entry.spec.command),
        binDir: this.deps.acpBinDir,
        installRoot: this.deps.acpInstallRoot,
        fetchImpl: this.deps.fetchImpl,
        shimArgs: entry.spec.args,
        shimEnv: entry.spec.env,
        env: this.spawnEnv(),
      });
    } else if (entry.installSource === "adapter" && entry.downloadUrl) {
      await installManagedAdapter({
        id: entry.id,
        label: entry.label,
        command: entry.spec.command,
        args: entry.spec.args,
        downloadUrl: entry.downloadUrl,
        binDir: this.deps.acpBinDir,
        fetchImpl: this.deps.fetchImpl,
      });
    } else {
      throw new Error(`${entry.label} is not installable from ${this.managedByName()}`);
    }
    return this.listAgents({ refresh: true, probeAuth: true });
  }

  async upgradeAgent(id: string): Promise<AcpAgentSetupInfo[]> {
    await this.refreshRegistry({ refresh: true });
    const entry = this.requireEntry(id);
    const installInfo = await this.managedInstallInfo(entry);
    if (!installInfo.installed) {
      throw new Error(`${entry.label} is not installed by ${this.managedByName()}`);
    }
    return this.installAgent(id);
  }

  async uninstallAgent(id: string): Promise<AcpAgentSetupInfo[]> {
    await this.refreshRegistry({ refresh: true });
    const entry = this.requireEntry(id);
    if (entry.installSource === "registry") {
      if (!entry.registryId) throw new Error(`${entry.label} is missing an ACP registry id`);
      await uninstallAcpRegistryAgent({
        registryId: entry.registryId,
        shimName: basename(entry.spec.command),
        binDir: this.deps.acpBinDir,
        installRoot: this.deps.acpInstallRoot,
      });
    } else if (entry.installSource === "adapter") {
      await uninstallManagedAdapter({
        command: entry.spec.command,
        binDir: this.deps.acpBinDir,
      });
    } else {
      throw new Error(`${entry.label} is not managed by ${this.managedByName()}`);
    }
    if (this.deps.getDefaultAgentId?.() === id) {
      await this.deps.saveDefaultAgentId?.("");
    }
    return this.listAgents({ refresh: true });
  }

  async authenticateAgent(id: string, options: { methodId?: string } = {}): Promise<AcpAgentSetupInfo[]> {
    await this.refreshRegistry({ refresh: false });
    const entry = await this.detectCatalogEntry(id);
    if (!entry) throw new Error(`ACP agent is not available: ${id}`);
    const result: AuthenticateAgentResult = await authenticateAgent({
      agent: entry.spec,
      env: this.spawnEnv(),
      ...(this.deps.probeCwd ? { cwd: this.deps.probeCwd } : {}),
      timeoutMs: 120_000,
      agentAuthLaunchGraceMs: 2_000,
      backgroundAuthTimeoutMs: 10 * 60_000,
      methodId: options.methodId,
      launchInteractiveAuth: this.deps.launchInteractiveAuth,
    });
    return this.listAgents({
      refresh: result.status === "completed",
      ...(result.status === "completed"
        ? { probeAuth: true }
        : { probeAgentId: id }),
    });
  }

  async setDefaultAgent(id: string): Promise<AcpAgentSetupInfo[]> {
    const normalized = id.trim();
    if (!this.deps.saveDefaultAgentId) {
      throw new Error("Default agent settings are not configured");
    }
    if (!normalized) {
      await this.deps.saveDefaultAgentId("");
      return this.listAgents({ probeAuth: true });
    }

    await this.refreshRegistry({ refresh: false });
    const entry = await this.detectCatalogEntry(normalized);
    if (!entry) throw new Error(`ACP agent is not available: ${normalized}`);
    const auth = await this.probeAuth(entry);
    if (auth && authBlocksDefault(auth)) {
      const suffix = auth.message ? ` ${auth.message}` : "";
      throw new Error(`Authenticate ${entry.label} before setting as default.${suffix}`);
    }
    await this.deps.saveDefaultAgentId(normalized);
    return this.listAgents({ probeAgentId: normalized });
  }

  private async refreshRegistry(options: { refresh?: boolean }): Promise<void> {
    if (this.deps.refreshRegistry) {
      await this.deps.refreshRegistry({ refresh: options.refresh });
      return;
    }
    await loadRegistry({
      cachePath: this.deps.registryCachePath,
      forceRefresh: options.refresh === true,
    }).catch(() => undefined);
  }

  private resolveOptions(): ResolveAgentCommandOptions {
    return {
      env: this.spawnEnv(),
      managedBinDirs: [this.deps.acpBinDir],
    };
  }

  private spawnEnv(): NodeJS.ProcessEnv {
    const path = [this.deps.acpBinDir, process.env.PATH].filter(Boolean).join(delimiter);
    return {
      ...process.env,
      ...this.deps.env,
      OPENMA_ACP_BIN_DIR: this.deps.acpBinDir,
      PATH: path,
    };
  }

  private requireEntry(id: string): SetupAgentEntry {
    const entry = this.catalogEntries().find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Unknown ACP agent: ${id}`);
    return entry;
  }

  private catalogEntries(): SetupAgentEntry[] {
    return catalogEntriesWithOverrides(getKnownAgents(), this.deps.agentOverrides?.() ?? []);
  }

  private async detectCatalogEntry(id: string): Promise<SetupAgentEntry | null> {
    const entry = this.catalogEntries().find((candidate) => candidate.id === id);
    if (!entry) return null;
    return await detectEntry(entry, this.resolveOptions()) as SetupAgentEntry | null;
  }

  private async managedInstallInfo(entry: KnownAgentEntry): Promise<{
    installed: boolean;
    installedVersion?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
  }> {
    const latestVersion = entry.version;
    if (!entry.installSource) {
      return {
        installed: false,
        ...(latestVersion ? { latestVersion } : {}),
      };
    }
    const shimPath = join(this.deps.acpBinDir, basename(entry.spec.command));
    const installed = await access(shimPath).then(() => true, () => false);
    if (!installed) {
      return {
        installed: false,
        ...(latestVersion ? { latestVersion } : {}),
      };
    }
    const metadata = entry.installSource === "registry" && entry.registryId
      ? await readAcpRegistryInstallMetadata({
          registryId: entry.registryId,
          binDir: this.deps.acpBinDir,
          installRoot: this.deps.acpInstallRoot,
        })
      : null;
    const installedVersion = metadata?.version;
    const updateAvailable = entry.installSource === "registry" && !!latestVersion && installedVersion !== latestVersion;
    return {
      installed: true,
      ...(installedVersion ? { installedVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      ...(updateAvailable ? { updateAvailable: true } : {}),
    };
  }

  private async probeAuth(entry: KnownAgentEntry): Promise<AcpAgentSetupAuth | undefined> {
    const status = await probeAgentAuthStatus({
      agent: entry.spec,
      env: this.spawnEnv(),
      ...(this.deps.probeCwd ? { cwd: this.deps.probeCwd } : {}),
      timeoutMs: this.deps.probeTimeoutMs ?? 15_000,
    });
    if (status.status === "none") return undefined;
    const method = status.methodName ?? status.methodId;
    const prefix = status.status === "configured"
      ? method ? `ACP auth is configured (${method}).` : "ACP auth is configured."
      : status.status === "needs-auth"
        ? method ? `Authentication required (${method}).` : "Authentication required."
        : "Could not verify auth.";
    return {
      status: status.status,
      message: status.message ? `${prefix} ${status.message}` : prefix,
      ...(status.methodId ? { methodId: status.methodId } : {}),
      ...(status.methodName ? { methodName: status.methodName } : {}),
      ...(status.methods ? { methods: status.methods.map((m) => ({
        id: m.id,
        ...(m.name ? { name: m.name } : {}),
        ...(m.description ? { description: m.description } : {}),
        ...(m.type ? { type: m.type } : {}),
        ...(m.vars ? { vars: m.vars } : {}),
        ...(m.link ? { link: m.link } : {}),
      })) } : {}),
    };
  }

  private async probeConfigOptions(entry: KnownAgentEntry): Promise<unknown[] | undefined> {
    const configOptions = await probeAgentConfigOptions({
      agent: entry.spec,
      env: this.spawnEnv(),
      ...(this.deps.probeCwd ? { cwd: this.deps.probeCwd } : {}),
      timeoutMs: this.deps.probeTimeoutMs ?? 15_000,
    });
    return configOptions.length > 0 ? configOptions : undefined;
  }

  private managedByName(): string {
    return this.deps.managedByName?.trim() || "this host";
  }
}

type SetupAgentEntry = KnownAgentEntry & { custom?: boolean };

function catalogEntriesWithOverrides(
  entries: readonly KnownAgentEntry[],
  overrides: readonly AcpAgentSetupOverride[],
): SetupAgentEntry[] {
  const overrideById = new Map(overrides.map((override) => [override.id, override]));
  const knownIds = new Set(entries.map((entry) => entry.id));
  const merged = entries.map((entry) => applyAgentOverride(entry, overrideById.get(entry.id)));

  for (const override of overrides) {
    if (knownIds.has(override.id)) continue;
    const command = override.command?.trim();
    if (!command) continue;
    const env = overrideEnv(override);
    merged.push({
      id: override.id,
      label: override.label?.trim() || override.id,
      spec: {
        command,
        ...(override.args ? { args: [...override.args] } : {}),
        ...(env ? { env } : {}),
      },
      custom: true,
    });
  }

  return merged;
}

function applyAgentOverride(
  entry: KnownAgentEntry,
  override?: AcpAgentSetupOverride,
): SetupAgentEntry {
  if (!override) return entry;
  const env = {
    ...(entry.spec.env ?? {}),
    ...(overrideEnv(override) ?? {}),
  };
  return {
    ...entry,
    ...(override.label?.trim() ? { label: override.label.trim() } : {}),
    spec: {
      ...entry.spec,
      ...(override.command?.trim() ? { command: override.command.trim() } : {}),
      ...(override.args ? { args: [...override.args] } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
  };
}

function overrideEnv(override: AcpAgentSetupOverride): Record<string, string> | undefined {
  if (!override.env) return undefined;
  const entries = Array.isArray(override.env)
    ? override.env
        .filter((item) => item.name.length > 0)
        .map((item): [string, string] => [item.name, item.value])
    : Object.entries(override.env)
        .filter((entry): entry is [string, string] => entry[0].length > 0 && typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function authBlocksDefault(auth: AcpAgentSetupAuth): boolean {
  return auth.status === "needs-auth" || auth.status === "unknown";
}

export interface LaunchTerminalAuthOptions {
  returnInstruction?: string;
}

export function launchTerminalAuth(
  options: TerminalAuthLaunchOptions,
  launchOptions: LaunchTerminalAuthOptions = {},
): Promise<void> {
  const shellCommand = terminalAuthShellCommand(options, launchOptions.returnInstruction);
  if (process.platform === "darwin") {
    return spawnDetached("osascript", [
      "-e", `tell application "Terminal"`,
      "-e", "activate",
      "-e", `do script ${JSON.stringify(shellCommand)}`,
      "-e", "end tell",
    ], options.env);
  }
  const terminal = process.platform === "win32" ? null : (process.env.TERMINAL || "x-terminal-emulator");
  if (!terminal) {
    throw new Error(`Interactive auth launch is not supported on ${process.platform}. Run ${[options.command, ...options.args].join(" ")} manually.`);
  }
  return spawnDetached(terminal, ["-e", "sh", "-lc", shellCommand], options.env);
}

function spawnDetached(
  command: string,
  args: string[],
  env?: Record<string, string | undefined>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...Object.fromEntries(Object.entries(env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      },
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function terminalAuthShellCommand(options: TerminalAuthLaunchOptions, returnInstruction?: string): string {
  const parts: string[] = [];
  if (options.cwd) {
    parts.push("cd", shellQuote(options.cwd), "&&");
  }
  const envEntries = Object.entries(options.env ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0].length > 0);
  if (envEntries.length > 0) {
    parts.push("env");
    for (const [key, value] of envEntries) parts.push(`${key}=${shellQuote(value)}`);
  }
  parts.push(shellQuote(options.command), ...options.args.map(shellQuote));
  if (returnInstruction?.trim()) {
    parts.push(";");
    parts.push("printf", shellQuote(`\\n${returnInstruction.trim()}\\n`));
  }
  return parts.join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
