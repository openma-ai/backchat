/**
 * Settings store — TOML file at ~/.openma/config.toml.
 *
 * Lives under ~/.openma/ so that a future shared openma cli + this
 * desktop frontend can read the same hand-edited settings. The dotdir
 * sits next to other ACP-agent dotdirs (~/.claude, ~/.codex). SQLite
 * + per-session spawn cwds also live under ~/.openma/ now (see
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
    /** Canonical agent id chosen as the "default browser" for new chats.
     *  Empty string means "no default — first detected wins". */
    agent_id: z.string().default(""),
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
  }),
  appearance: z.object({
    theme: z.enum(["system", "light", "dark"]).default("system"),
    font_size: z.enum(["sm", "md", "lg"]).default("md"),
    density: z.enum(["compact", "default", "roomy"]).default("default"),
  }),
  agents: z.array(AgentOverrideSchema).default([]),
  mcp_servers: z.array(McpServerSchema).default([]),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type AgentOverride = z.infer<typeof AgentOverrideSchema>;

// Seed used when no config file exists yet. Spelt out so zod 4 doesn't have
// to infer defaults for parent objects from their inner-field defaults —
// which it refuses to do without thunks.
const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({
  default: {},
  appearance: {},
  agents: [],
  mcp_servers: [],
});

// -------------------- File location --------------------

export const SETTINGS_DIR = openmaRoot();
export const SETTINGS_FILE = join(SETTINGS_DIR, "config.toml");

// -------------------- Store --------------------

type Listener = (s: Settings) => void;

class SettingsStore {
  #current: Settings = DEFAULT_SETTINGS;
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
    if (!existsSync(SETTINGS_FILE)) {
      await mkdir(SETTINGS_DIR, { recursive: true });
      await writeFile(SETTINGS_FILE, this.#serializeWithHeader(DEFAULT_SETTINGS), "utf-8");
      this.#current = DEFAULT_SETTINGS;
      return this.#current;
    }
    const raw = readFileSync(SETTINGS_FILE, "utf-8");
    let parsed: unknown;
    try {
      parsed = parseToml(raw);
    } catch (e) {
      throw new Error(
        `${SETTINGS_FILE} is not valid TOML: ${(e as Error).message}. ` +
          `Fix the syntax or delete the file to regenerate defaults.`,
      );
    }
    const result = SettingsSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `${SETTINGS_FILE} has unexpected fields: ${result.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ")}.`,
      );
    }
    this.#current = result.data;
    return this.#current;
  }

  get(): Settings {
    return this.#current;
  }

  /** Replace the entire settings object. Used by the UI's "save" action on
   *  the bulkier forms. Validates with the same schema as load(). */
  async set(next: Settings): Promise<void> {
    this.#current = SettingsSchema.parse(next);
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
