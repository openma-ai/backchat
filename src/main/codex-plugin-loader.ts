import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { SettingsMcpServer } from "../shared/settings.js";

const RelativePathSchema = z.string().min(3);
const PathListSchema = z.union([
  RelativePathSchema,
  z.array(RelativePathSchema),
]);

const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  skills: PathListSchema.optional(),
  mcpServers: PathListSchema.optional(),
  apps: PathListSchema.optional(),
  hooks: z.union([
    PathListSchema,
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown())),
  ]).optional(),
  interface: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type CodexPluginManifest = z.infer<typeof PluginManifestSchema>;

export type CodexPluginRequirement = {
  kind: "oauth";
  serverId: string;
  resource: string;
};

export interface CodexPluginSkill {
  name: string;
  description: string;
  pluginName: string;
  pluginRoot: string;
  file: string;
}

export interface LoadedCodexPlugin {
  root: string;
  manifestPath: string;
  manifest: CodexPluginManifest;
  paths: {
    skills: string[];
    mcpServers: string[];
    apps: string[];
    hooks: string[];
  };
  skillFiles: string[];
  skills: CodexPluginSkill[];
  inlineHooks: Record<string, unknown>[];
  mcpServers: SettingsMcpServer[];
  requirements: CodexPluginRequirement[];
}

export interface CodexPluginLoadError {
  root: string;
  message: string;
}

export interface CodexPluginCatalog {
  plugins: LoadedCodexPlugin[];
  errors: CodexPluginLoadError[];
  mcpServers: SettingsMcpServer[];
}

type JsonObject = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === ""
    || (!pathFromParent.startsWith(`..${sep}`)
      && pathFromParent !== ".."
      && !isAbsolute(pathFromParent));
}

function resolvePluginPath(pluginRoot: string, manifestPath: string): string {
  if (!manifestPath.startsWith("./")) {
    throw new Error(`Plugin path must start with "./": ${manifestPath}`);
  }
  const absoluteRoot = realpathSync(pluginRoot);
  const candidate = resolve(absoluteRoot, manifestPath);
  if (!isInside(absoluteRoot, candidate)) {
    throw new Error(`Plugin path must stay inside the plugin root: ${manifestPath}`);
  }
  if (!existsSync(candidate)) {
    throw new Error(`Plugin path does not exist: ${manifestPath}`);
  }
  const realCandidate = realpathSync(candidate);
  if (!isInside(absoluteRoot, realCandidate)) {
    throw new Error(`Plugin path must stay inside the plugin root: ${manifestPath}`);
  }
  return realCandidate;
}

function resolvePluginPaths(
  pluginRoot: string,
  value: string | string[] | undefined,
): string[] {
  return asArray(value).map((path) => resolvePluginPath(pluginRoot, path));
}

function collectSkillFiles(skillRoots: readonly string[]): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = realpathSync(path);
        if (!isInside(directory, resolved)) continue;
        if (lstatSync(resolved).isDirectory()) visit(resolved);
        else if (entry.name === "SKILL.md") files.push(resolved);
      } else if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        files.push(path);
      }
    }
  };
  for (const root of skillRoots) {
    if (lstatSync(root).isDirectory()) visit(root);
    else if (root.endsWith("SKILL.md")) files.push(root);
  }
  return files.sort();
}

function frontmatterValue(source: string, key: string): string | undefined {
  if (!source.startsWith("---\n")) return undefined;
  const end = source.indexOf("\n---", 4);
  if (end < 0) return undefined;
  const lines = source.slice(4, end).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;
    const value = match[1]!.trim();
    if (value === "|" || value === ">") {
      const parts: string[] = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const nested = lines[next]!;
        if (!/^\s+/.test(nested)) break;
        parts.push(nested.trim());
      }
      return parts.join(value === ">" ? " " : "\n").trim();
    }
    return value.replace(/^(['"])(.*)\1$/, "$2").trim();
  }
  return undefined;
}

function loadSkills(
  pluginName: string,
  pluginRoot: string,
  files: readonly string[],
): CodexPluginSkill[] {
  return files.map((file) => {
    const source = readFileSync(file, "utf8");
    return {
      name: frontmatterValue(source, "name") || basename(dirname(file)),
      description: frontmatterValue(source, "description") || "",
      pluginName,
      pluginRoot,
      file,
    };
  });
}

function expandPluginRoot(value: string, pluginRoot: string): string {
  return value
    .replaceAll("${PLUGIN_ROOT}", pluginRoot)
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot);
}

function resolveInsidePlugin(
  pluginRoot: string,
  base: string,
  value: string,
): string {
  const candidate = resolve(base, value);
  if (!isInside(pluginRoot, candidate)) {
    throw new Error(`MCP path must stay inside the plugin root: ${value}`);
  }
  if (!existsSync(candidate)) {
    throw new Error(`MCP path does not exist: ${value}`);
  }
  const realCandidate = realpathSync(candidate);
  if (!isInside(pluginRoot, realCandidate)) {
    throw new Error(`MCP path must stay inside the plugin root: ${value}`);
  }
  return realCandidate;
}

function resolveMcpWorkingDirectory(
  pluginRoot: string,
  value: unknown,
): string {
  if (value === undefined || value === ".") return pluginRoot;
  if (typeof value !== "string" || !value.startsWith("./")) {
    throw new Error('MCP cwd must be "." or a "./"-prefixed plugin path');
  }
  const directory = resolveInsidePlugin(pluginRoot, pluginRoot, value);
  if (!lstatSync(directory).isDirectory()) {
    throw new Error(`MCP cwd is not a directory: ${value}`);
  }
  return directory;
}

function normalizePairs(
  value: unknown,
  label: "env" | "headers",
  pluginRoot: string,
): Array<{ name: string; value: string }> {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (!isObject(entry)
        || typeof entry.name !== "string"
        || typeof entry.value !== "string") {
        throw new Error(`Invalid MCP ${label}[${index}] entry`);
      }
      return {
        name: entry.name,
        value: expandPluginRoot(entry.value, pluginRoot),
      };
    });
  }
  if (!isObject(value)) throw new Error(`Invalid MCP ${label} value`);
  return Object.entries(value).map(([name, entry]) => {
    if (typeof entry !== "string") {
      throw new Error(`Invalid MCP ${label}.${name} value`);
    }
    return { name, value: expandPluginRoot(entry, pluginRoot) };
  });
}

function unwrapMcpServerMap(value: unknown): JsonObject {
  if (!isObject(value)) throw new Error("MCP manifest must contain a JSON object");
  const wrapped = value.mcpServers ?? value.mcp_servers;
  if (wrapped !== undefined) {
    if (!isObject(wrapped)) throw new Error("MCP server wrapper must contain an object");
    return wrapped;
  }
  return value;
}

function normalizeMcpServer(
  pluginName: string,
  pluginRoot: string,
  serverName: string,
  value: unknown,
): {
  server?: SettingsMcpServer;
  requirement?: CodexPluginRequirement;
} {
  if (!isObject(value)) throw new Error(`Invalid MCP server "${serverName}"`);
  if (value.enabled === false) return {};
  const id = `plugin:${pluginName}:${serverName}`;
  const name = `${pluginName} / ${serverName}`;

  if (typeof value.command === "string") {
    const workingDirectory = resolveMcpWorkingDirectory(pluginRoot, value.cwd);
    const expandedCommand = expandPluginRoot(value.command, pluginRoot);
    const command = expandedCommand.startsWith("./")
      ? resolveInsidePlugin(pluginRoot, workingDirectory, expandedCommand)
      : expandedCommand;
    const args = value.args === undefined ? [] : value.args;
    if (!Array.isArray(args) || args.some((entry) => typeof entry !== "string")) {
      throw new Error(`Invalid MCP args for "${serverName}"`);
    }
    return {
      server: {
        id,
        type: "stdio",
        name,
        command,
        args: args.map((entry) => {
          const expanded = expandPluginRoot(entry, pluginRoot);
          return expanded.startsWith("./") || expanded.startsWith("../")
            ? resolveInsidePlugin(pluginRoot, workingDirectory, expanded)
            : expanded;
        }),
        env: normalizePairs(value.env, "env", pluginRoot),
      },
    };
  }

  if (typeof value.url === "string") {
    const transport = value.type ?? value.transport ?? "http";
    const type = transport === "sse" ? "sse" : "http";
    if (!["http", "streamable-http", "sse"].includes(String(transport))) {
      throw new Error(`Unsupported MCP transport for "${serverName}": ${String(transport)}`);
    }
    const oauthResource = value.oauth_resource ?? value.oauthResource;
    if (oauthResource !== undefined && typeof oauthResource !== "string") {
      throw new Error(`Invalid OAuth resource for "${serverName}"`);
    }
    return {
      server: {
        id,
        type,
        name,
        url: value.url,
        headers: normalizePairs(value.headers, "headers", pluginRoot),
      },
      ...(typeof oauthResource === "string"
        ? {
            requirement: {
              kind: "oauth" as const,
              serverId: id,
              resource: oauthResource,
            },
          }
        : {}),
    };
  }

  throw new Error(`MCP server "${serverName}" needs either "command" or "url"`);
}

function loadMcpServers(
  pluginName: string,
  pluginRoot: string,
  paths: readonly string[],
): {
  servers: SettingsMcpServer[];
  requirements: CodexPluginRequirement[];
} {
  const servers: SettingsMcpServer[] = [];
  const requirements: CodexPluginRequirement[] = [];
  for (const path of paths) {
    const entries = unwrapMcpServerMap(readJson(path));
    for (const [serverName, value] of Object.entries(entries)) {
      const normalized = normalizeMcpServer(
        pluginName,
        pluginRoot,
        serverName,
        value,
      );
      if (normalized.server) servers.push(normalized.server);
      if (normalized.requirement) requirements.push(normalized.requirement);
    }
  }
  return { servers, requirements };
}

function inlineHookObjects(value: CodexPluginManifest["hooks"]): Record<string, unknown>[] {
  if (value === undefined || typeof value === "string") return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => isObject(entry));
  }
  return isObject(value) ? [value] : [];
}

function hookPathValues(value: CodexPluginManifest["hooks"]): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

export function loadCodexPlugin(root: string): LoadedCodexPlugin {
  const pluginRoot = realpathSync(root);
  const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  const manifest = PluginManifestSchema.parse(readJson(manifestPath));
  const skills = resolvePluginPaths(pluginRoot, manifest.skills);
  const mcpServers = resolvePluginPaths(pluginRoot, manifest.mcpServers);
  const apps = resolvePluginPaths(pluginRoot, manifest.apps);
  const explicitHooks = hookPathValues(manifest.hooks);
  const defaultHookPath = join(pluginRoot, "hooks", "hooks.json");
  const hooks = explicitHooks.length > 0
    ? resolvePluginPaths(pluginRoot, explicitHooks)
    : existsSync(defaultHookPath)
      ? [realpathSync(defaultHookPath)]
      : [];
  const mcp = loadMcpServers(manifest.name, pluginRoot, mcpServers);
  const skillFiles = collectSkillFiles(skills);

  return {
    root: pluginRoot,
    manifestPath,
    manifest,
    paths: { skills, mcpServers, apps, hooks },
    skillFiles,
    skills: loadSkills(manifest.name, pluginRoot, skillFiles),
    inlineHooks: inlineHookObjects(manifest.hooks),
    mcpServers: mcp.servers,
    requirements: mcp.requirements,
  };
}

function pluginRootsInside(root: string): string[] {
  if (!existsSync(root)) return [];
  const directManifest = join(root, ".codex-plugin", "plugin.json");
  if (existsSync(directManifest)) return [root];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((candidate) => existsSync(join(candidate, ".codex-plugin", "plugin.json")))
    .sort();
}

export function discoverCodexPlugins(
  roots: readonly string[],
): CodexPluginCatalog {
  const plugins: LoadedCodexPlugin[] = [];
  const errors: CodexPluginLoadError[] = [];
  const seenNames = new Set<string>();

  for (const root of roots) {
    for (const pluginRoot of pluginRootsInside(root)) {
      try {
        const plugin = loadCodexPlugin(pluginRoot);
        if (seenNames.has(plugin.manifest.name)) {
          errors.push({
            root: pluginRoot,
            message: `Duplicate plugin name: ${plugin.manifest.name}`,
          });
          continue;
        }
        seenNames.add(plugin.manifest.name);
        plugins.push(plugin);
      } catch (error) {
        errors.push({
          root: pluginRoot,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    plugins,
    errors,
    mcpServers: plugins.flatMap((plugin) => plugin.mcpServers),
  };
}
