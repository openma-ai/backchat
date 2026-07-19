import type { SettingsMcpServer } from "../shared/settings.js";
import {
  discoverCodexPlugins,
  type CodexPluginCatalog,
  type CodexPluginSkill,
} from "./codex-plugin-loader.js";

const EMPTY_CATALOG: CodexPluginCatalog = {
  plugins: [],
  errors: [],
  mcpServers: [],
};

/**
 * Process-lifetime owner for Codex-compatible plugin capabilities.
 *
 * Discovery is intentionally lifecycle-bound: cold startup and explicit
 * refresh rebuild the snapshot; opening a real ACP session only reads it.
 * That keeps filesystem work and plugin validation out of session startup.
 */
export class CodexPluginRuntime {
  readonly #roots: readonly string[];
  #catalog: CodexPluginCatalog = EMPTY_CATALOG;

  constructor(roots: readonly string[]) {
    this.#roots = [...roots];
  }

  start(): CodexPluginCatalog {
    return this.refresh();
  }

  refresh(): CodexPluginCatalog {
    this.#catalog = discoverCodexPlugins(this.#roots);
    return this.#catalog;
  }

  snapshot(): CodexPluginCatalog {
    return this.#catalog;
  }

  mcpServers(): readonly SettingsMcpServer[] {
    return this.#catalog.mcpServers;
  }

  skills(): CodexPluginSkill[] {
    return this.#catalog.plugins.flatMap((plugin) => plugin.skills);
  }

  /**
   * User configuration wins on an explicit id collision. Plugin MCP ids are
   * namespaced, so collisions should only happen when a user deliberately
   * overrides one.
   */
  withConfiguredMcpServers(
    configured: readonly SettingsMcpServer[],
  ): SettingsMcpServer[] {
    const ids = new Set(configured.map((server) => server.id));
    return [
      ...configured,
      ...this.#catalog.mcpServers.filter((server) => !ids.has(server.id)),
    ];
  }
}
