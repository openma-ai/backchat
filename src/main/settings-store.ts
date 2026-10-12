/**
 * Settings store — TOML file at ~/.oma/config.toml.
 *
 * Lives under ~/.oma/ so that the OMA CLI and this desktop frontend can
 * read the same hand-edited settings. The dotdir
 * sits next to other ACP-agent dotdirs (~/.claude, ~/.codex). SQLite
 * + per-session spawn cwds also live under ~/.oma/ now (see
 * main/index.ts setSessionRoot / openSessionDb).
 *
 * smol-toml is preferred over JSON because:
 *   - users will edit this file by hand for env-var secrets and MCP server
 *     URLs; TOML's inline comments make those rows annotatable
 *   - sections like [appearance] / [[mcp_servers]] read cleaner than nested
 *     JSON for users coming from rustup, pyproject, Cargo, etc.
 *   - we keep it ~8 KB additional dependency
 *
 * Concurrency: writes are serialized through a single in-flight chain so
 * rapid successive patches don't tear the file. We never watch the file
 * back from disk — settings flow always goes through patchSettings(), which
 * updates the in-memory copy synchronously and triggers listeners before
 * the disk write resolves (optimistic UI). A future "external edit" reload
 * is wantable but adds complexity (fs.watch + zod re-validation) and the
 * user opening the file in vim while the desktop is running is not a
 * Phase 3 concern.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml, stringify as toToml } from "smol-toml";
import { z } from "zod";
import {
  customAcpAgentFromConfigTomlRow,
  migrateLegacyAcpAgents,
} from "@openma/common/acp-harnesses/custom-agents";
import { openmaRoot } from "./storage-root.js";

// -------------------- Schema --------------------

const McpServerSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("http"),
    name: z.string().min(1),
    url: z.string().url(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("sse"),
    name: z.string().min(1),
    url: z.string().url(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("stdio"),
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  }),
]);

const AgentOverrideSchema = z.object({
  /** Canonical id from the registry. Overrides for unknown ids are kept
   *  around so a user can keep settings for an agent they uninstalled and
   *  reinstall later without losing config. */
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  label_override: z.string().optional(),
  command_override: z.string().optional(),
  args_override: z.array(z.string()).optional(),
  /** Env vars merged into the spawned ACP child's process.env. Stored as
   *  ordered [{name, value}] rather than a record so TOML serializes them
   *  predictably and we can mask the value in the UI without losing key
   *  order on rewrite. */
  env: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
});

const SettingsSchema = z.object({
  default: z.object({
    /** Default cwd for new sessions. Empty string → fallback to $HOME. */
    workspace_path: z.string().default(""),
    /** Composer permission mode — how the renderer answers ACP permission
     *  asks. The main-process broker still ASKS for every tool call (it's
     *  the boundary), but the renderer auto-clicks the matching option
     *  when the user has picked a non-"ask" mode in the composer chip.
     *    "ask"       → modal pops as today; user picks per ask.
     *    "auto"      → renderer picks the first allow_once option (or
     *                  approves out-of-cwd writes) silently.
     *    "read_only" → renderer picks the first reject_once option (or
     *                  denies out-of-cwd writes). Tools that don't write
     *                  still succeed; tools that write get a clean refuse
     *                  so the agent can react instead of hanging.
     */
    permission_mode: z.enum(["ask", "auto", "read_only"]).default("ask"),
    /** Follow-up prompt behavior. Enabled mirrors Clash's single prompt
     *  queue: a second prompt waits for the active agent loop to finish.
     *  Disabled preserves immediate concurrent prompt dispatch. */
    prompt_queue_enabled: z.boolean().default(true),
  }).prefault({}),
  appearance: z.object({
    light_theme_id: z.string().min(1).default("backchat-light"),
    dark_theme_id: z.string().min(1).default("backchat-dark"),
    theme: z.enum(["system", "light", "dark"]).default("system"),
    language: z.enum(["system", "en", "zh-CN"]).default("system"),
    font_size: z.enum(["sm", "md", "lg"]).default("md"),
    density: z.enum(["compact", "default", "roomy"]).default("default"),
  }).prefault({}),
  browser: z.object({
    enabled: z.boolean().default(true),
    web_link_target: z.enum(["external", "in_app"]).default("external"),
    local_link_target: z.enum(["external", "in_app"]).default("in_app"),
    annotation_screenshots: z.enum(["always", "never"]).default("always"),
    default_zoom: z.number().min(0.5).max(2).default(1),
    download_path: z.string().default(""),
    ask_before_download: z.boolean().default(false),
    autofill_enabled: z.boolean().default(false),
  }).optional(),
  agents: z.array(AgentOverrideSchema).default([]),
  mcp_servers: z.array(McpServerSchema).default([]),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type AgentOverride = z.infer<typeof AgentOverrideSchema>;

// Seed used when no config file exists yet. Spelt out so zod 4 doesn't have
// to infer defaults for parent objects from their inner-field defaults —
// which it refuses to do without thunks.
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({
  default: {},
  appearance: {},
  agents: [],
  mcp_servers: [],
});

export function hasDeprecatedAgentDefault(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const defaults = (value as Record<string, unknown>).default;
  return Boolean(
    defaults
      && typeof defaults === "object"
      && Object.prototype.hasOwnProperty.call(defaults, "agent_id"),
  );
}

export function migrateDeprecatedWorkspacePath(settings: Settings): {
  settings: Settings;
  changed: boolean;
} {
  if (!settings.default.workspace_path.trim()) {
    return { settings, changed: false };
  }
  return {
    changed: true,
    settings: {
      ...settings,
      default: {
        ...settings.default,
        workspace_path: "",
      },
    },
  };
}

// -------------------- Custom ACP agents (shared ~/.oma store) --------------------

// Custom agent definitions live in config.toml itself: a `[[agents]]` row
// with `command_override` IS the shared definition both Backchat and Martty
// read and write (schema owned by @openma/common/acp-harnesses/custom-agents).
// Backchat only needs two pieces of shared logic here:
//
//   * `migrateLegacyAcpAgents` on load — folds Martty's old settings.json
//     `harnesses[]` into config.toml rows once and strips the legacy key.
//   * per-row reconciliation on set() — rows the user did not touch since
//     load defer to what is on disk now, so a Martty-side add/edit/remove in
//     the meantime is not clobbered by a stale in-memory copy.

/** The `[[agents]]` rows currently on disk, or [] when the file is missing
 *  or unparseable (an unparseable file is load()'s problem, not set()'s). */
function agentRowsFromDisk(path: string): unknown[] {
  try {
    const config = parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
    return Array.isArray(config.agents) ? config.agents : [];
  } catch {
    return [];
  }
}

/** Raw TOML row → schema-shaped override, normalizing env to [{name,value}]. */
function agentOverrideFromTomlRow(row: unknown): AgentOverride | undefined {
  const r = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : undefined;
  if (!r || typeof r.id !== "string" || !r.id) return undefined;
  const def = customAcpAgentFromConfigTomlRow(row);
  const out: AgentOverride = { id: r.id, env: [] };
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (def) {
    if (def.label !== def.id) out.label_override = def.label;
    out.command_override = def.command;
    if (def.args.length > 0) out.args_override = [...def.args];
    out.env = Object.entries(def.env ?? {}).map(([name, value]) => ({ name, value }));
  } else if (Array.isArray(r.env)) {
    out.env = r.env.flatMap((entry) => {
      const e = typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : undefined;
      return typeof e?.name === "string" && typeof e?.value === "string"
        ? [{ name: e.name, value: e.value }]
        : [];
    });
  }
  return out;
}

/**
 * Merge `next` agent rows with the rows on disk right now, per id:
 *   - a row the user changed (or added) wins;
 *   - a row untouched since load takes whatever is on disk — including its
 *     absence, which is how a Martty-side remove propagates;
 *   - a disk row never seen at load is a foreign add and is appended.
 * `loaded` maps id → JSON of the row as load() normalized it.
 */
function reconcileAgentRows(
  next: AgentOverride[],
  diskRows: unknown[],
  loaded: ReadonlyMap<string, string>,
): AgentOverride[] {
  const diskById = new Map<string, unknown>();
  for (const row of diskRows) {
    const id = typeof row === "object" && row !== null
      ? (row as Record<string, unknown>).id
      : undefined;
    if (typeof id === "string" && id && !diskById.has(id)) diskById.set(id, row);
  }
  const merged = next.flatMap((row) => {
    const disk = diskById.get(row.id);
    diskById.delete(row.id);
    if (JSON.stringify(row) !== loaded.get(row.id)) return [row]; // user edit/add
    if (disk === undefined) return [];                            // removed externally
    return [agentOverrideFromTomlRow(disk) ?? row];               // disk version wins
  });
  for (const row of diskById.values()) {
    const id = (row as Record<string, unknown>).id as string;
    if (!loaded.has(id)) {
      const override = agentOverrideFromTomlRow(row);
      if (override) merged.push(override);
    }
  }
  return merged;
}

// -------------------- File location --------------------

export const SETTINGS_DIR = openmaRoot();
export const SETTINGS_FILE = join(SETTINGS_DIR, "config.toml");

// -------------------- Store --------------------

type Listener = (s: Settings) => void;

class SettingsStore {
  #current: Settings = DEFAULT_SETTINGS;
  /** Agent rows as load()/set() last normalized them, id → JSON — the
   *  "untouched" baseline set() reconciles against the file on disk. */
  #loadedAgentRows = new Map<string, string>();
  #listeners = new Set<Listener>();
  /** Tail of the in-flight write chain — every `set()` awaits the prior
   *  write to keep on-disk state in sync with mutation order. */
  #writeTail: Promise<void> = Promise.resolve();

  /** Load on app startup. Returns parsed settings; missing file → defaults
   *  written to disk so the user sees an editable file next to the app on
   *  first launch. Parse errors are surfaced to caller — main.ts should
   *  show a notice + fall back to defaults rather than overwriting a
   *  syntactically broken file the user may have been editing. */
  async load(): Promise<Settings> {
    // Fold Martty's legacy settings.json harnesses into config.toml rows.
    // Runs before the file check so a config.toml it creates is seen below;
    // a failure only means no migration happened, never a broken load.
    try {
      if (migrateLegacyAcpAgents(SETTINGS_DIR)) {
        process.stderr.write(
          "[settings] migrated Martty settings.json harnesses into config.toml agents\n",
        );
      }
    } catch (e) {
      process.stderr.write(
        `! legacy agent migration failed: ${(e as Error).message}\n`,
      );
    }
    if (!existsSync(SETTINGS_FILE)) {
      await mkdir(SETTINGS_DIR, { recursive: true });
      await writeFile(SETTINGS_FILE, this.#serializeWithHeader(DEFAULT_SETTINGS), "utf-8");
      this.#loadedAgentRows = new Map(
        DEFAULT_SETTINGS.agents.map((row) => [row.id, JSON.stringify(row)]),
      );
      this.#current = DEFAULT_SETTINGS;
      return this.#current;
    }
    const raw = readFileSync(SETTINGS_FILE, "utf8");
    let parsed: unknown;
    try {
      parsed = parseToml(raw);
    } catch (e) {
      throw new Error(
        `${SETTINGS_FILE} is not valid TOML: ${(e as Error).message}. ` +
          `Fix the syntax or delete the file to regenerate defaults.`,
      );
    }
    const deprecatedAgentDefault = hasDeprecatedAgentDefault(parsed);
    const result = SettingsSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `${SETTINGS_FILE} has unexpected fields: ${result.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ")}.`,
      );
    }
    const migration = migrateDeprecatedWorkspacePath(result.data);
    this.#current = migration.settings;
    this.#loadedAgentRows = new Map(
      migration.settings.agents.map((row) => [row.id, JSON.stringify(row)]),
    );
    if (migration.changed || deprecatedAgentDefault) {
      await writeFile(
        SETTINGS_FILE,
        this.#serializeWithHeader(this.#current),
        "utf-8",
      );
      if (deprecatedAgentDefault) {
        process.stderr.write(
          "[settings] removed deprecated default.agent_id; run selection is recent-use based\n",
        );
      }
      if (migration.changed) {
        process.stderr.write(
          "[settings] removed deprecated default.workspace_path; project ownership is per chat\n",
        );
      }
    }
    return this.#current;
  }

  get(): Settings {
    return this.#current;
  }

  /** Replace the entire settings object. Used by the UI's "save" action on
   *  the bulkier forms. Validates with the same schema as load(). Agent rows
   *  reconcile per id against the file on disk first, so edits another app
   *  (Martty) made to the shared store since load() are not clobbered. */
  async set(next: Settings): Promise<void> {
    const parsed = SettingsSchema.parse(next);
    const agents = reconcileAgentRows(
      parsed.agents,
      agentRowsFromDisk(SETTINGS_FILE),
      this.#loadedAgentRows,
    );
    this.#current = { ...parsed, agents };
    this.#loadedAgentRows = new Map(agents.map((row) => [row.id, JSON.stringify(row)]));
    this.#emit();
    this.#writeTail = this.#writeTail.then(() =>
      writeFile(SETTINGS_FILE, this.#serializeWithHeader(this.#current), "utf-8").catch(
        (e) => {
          // Disk full / permission denied — surface to stderr so the daemon
          // log carries it. UI shows a sonner toast separately (caller of
          // patch sees the rejected promise).
          process.stderr.write(`! settings write failed: ${(e as Error).message}\n`);
          throw e;
        },
      ),
    );
    await this.#writeTail;
  }

  /** Shallow merge — top-level keys replaced wholesale. Lets call sites do
   *  `patch({ appearance: { theme: 'dark', ...etc } })` without spelling
   *  out every untouched section. */
  async patch(partial: Partial<Settings>): Promise<void> {
    await this.set({ ...this.#current, ...partial });
  }

  subscribe(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }

  #emit() {
    for (const l of this.#listeners) l(this.#current);
  }

  /** Prepend a comment header so the user knows the file is hand-editable
   *  and find their way to relevant docs. smol-toml's stringify drops
   *  comments on round-trip; the header is the only "in-band" hint we get. */
  #serializeWithHeader(s: Settings): string {
    const header = [
      "# backchat config",
      "# https://github.com/minimax/backchat",
      "#",
      "# Edit this file with the app closed for safest results. The app",
      "# rewrites this file on every settings change and drops comments.",
      "",
    ].join("\n");
    return header + toToml(s as unknown as Record<string, unknown>) + "\n";
  }
}

export const settingsStore = new SettingsStore();
