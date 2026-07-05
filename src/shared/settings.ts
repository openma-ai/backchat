/**
 * Shared settings type — structurally identical to the zod schema in
 * src/main/settings-store.ts. The renderer imports this; main imports
 * the schema directly so type drift between the two is caught when the
 * schema changes (the structural shape here would no longer line up).
 *
 * Stored at ~/.openma/config.toml. See settings-store.ts for
 * the full rationale (TOML over JSON, home dir over userData, etc).
 */

export interface SettingsDefault {
  /** Canonical agent id chosen as the "default browser" for new chats.
   *  Empty string means "no default — first detected wins". */
  agent_id: string;
  /** Default cwd for new sessions. Empty string → fallback to $HOME. */
  workspace_path: string;
  /** Composer permission mode. See settings-store.ts for the full
   *  semantics; "ask" pops the existing broker modal, "auto" silently
   *  picks allow_once, "read_only" silently picks reject_once. */
  permission_mode: "ask" | "auto" | "read_only";
  /** When true, follow-up prompts wait behind the current agent loop. */
  prompt_queue_enabled: boolean;
}

export interface SettingsAppearance {
  theme: "system" | "light" | "dark";
  font_size: "sm" | "md" | "lg";
  density: "compact" | "default" | "roomy";
}

export interface SettingsAgentOverride {
  id: string;
  enabled?: boolean;
  label_override?: string;
  command_override?: string;
  args_override?: string[];
  env: Array<{ name: string; value: string }>;
}

export type SettingsMcpServer =
  | {
      id: string;
      type: "http" | "sse";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    }
  | {
      id: string;
      type: "stdio";
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    };

export interface Settings {
  default: SettingsDefault;
  appearance: SettingsAppearance;
  agents: SettingsAgentOverride[];
  mcp_servers: SettingsMcpServer[];
}
