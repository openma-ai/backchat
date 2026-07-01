/**
 * Static overlay over the official ACP registry.
 *
 * The official registry at
 * https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json is the
 * source of truth for ACP-compatible agents (~35 entries, auto-updated). This
 * file holds only the deltas the desktop needs on top:
 *
 *   1. Featured-agent ordering (the four we promote in the agent picker).
 *   2. Agents not in the official registry yet (hermes, openclaw).
 *
 * Browser-safe (no node deps): the renderer can import this directly when it
 * just needs an entry's display label / install hint without rewinding through
 * IPC. The main process additionally fetches the full official registry at
 * runtime (registry-fetch.ts) and merges.
 */

import type { AgentSpec } from "./types.js";

export interface KnownAgentConfigSelectValue {
  value: string;
  name: string;
  description?: string | null;
}

export interface KnownAgentConfigOption {
  id: string;
  name: string;
  type: "select" | "boolean" | "string";
  category?: string | null;
  description?: string | null;
  currentValue?: string;
  options?: KnownAgentConfigSelectValue[];
}

export interface KnownAgentEntry {
  /** Canonical id used by hosts and dropdowns. Slug-only, no spaces. */
  id: string;
  label: string;
  spec: AgentSpec;
  /** Registry-advertised version string (semver). Used by
   *  acp-binary-update.ts to compare against the locally-installed
   *  binary's reported version. Optional because overlay entries
   *  (claude-acp, openclaw, …) don't ship versions; only entries that
   *  pass through `mapOfficialAgent` carry one. */
  version?: string;
  installHint?: string;
  homepage?: string;
  /** UI signal: render in the picker's first group. */
  featured?: boolean;
  /** Native ACP CLI supplied by the user's system PATH. Registry-managed
   *  shims are resolved from Backchat's managed ACP bin directory first. */
  systemPath?: boolean;
  /** Public ACP registry id. Used for app-managed installs. */
  registryId?: string;
  /** Install source for entries Backchat can install into its managed bin dir. */
  installSource?: "registry" | "adapter";
  /** Backchat-hosted executable URL for app-managed adapter installs. */
  downloadUrl?: string;
  /** Only lightweight ACP adapters/shims may be app-managed downloads. */
  downloadKind?: "adapter";
  /** Initial UI seed. Live ACP session config_options override this. */
  configOptions?: KnownAgentConfigOption[];
  /** If set, this entry is an ACP wrapper around a separate upstream binary
   *  (e.g. claude-acp wraps `claude`). Used by the Settings → Agents page to
   *  distinguish "you have claude but need the wrapper" from "the agent
   *  itself isn't installed". */
  wraps?: string;
  /** How to install. `npm` is auto-installable from the UI; `binary` needs the
   *  user to download and place on PATH. */
  install?:
    | { kind: "npm"; package: string }
    | {
        kind: "binary";
        archives: Partial<Record<string, { url: string; cmd: string }>>;
        downloadUrl?: string;
      };
}

export function registryShimName(id: string): string {
  return `openma-acp-${id}`;
}

const CODEX_CONFIG_OPTIONS = [
  {
    id: "model",
    name: "Model",
    type: "select" as const,
    category: "model",
    currentValue: "gpt-5.5",
    options: [
      { value: "gpt-5.5", name: "GPT-5.5", description: "Codex conversational model" },
      { value: "gpt-5.4", name: "GPT-5.4", description: "Codex compatibility profile" },
    ],
  },
  {
    id: "thought_level",
    name: "Thinking effort",
    type: "select" as const,
    category: "thought_level",
    currentValue: "medium",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
];

export const OVERLAY_AGENTS: KnownAgentEntry[] = [
  {
    id: "claude-acp",
    label: "Claude",
    spec: { command: "claude-agent-acp" },
    featured: true,
    wraps: "claude",
    registryId: "claude-acp",
    installSource: "registry",
    install: { kind: "npm", package: "@agentclientprotocol/claude-agent-acp" },
    installHint: "npm install -g @agentclientprotocol/claude-agent-acp",
    homepage: "https://github.com/agentclientprotocol/claude-agent-acp",
  },
  {
    id: "codex-acp",
    label: "Codex",
    spec: { command: "codex-acp" },
    featured: true,
    wraps: "codex",
    registryId: "codex-acp",
    installSource: "registry",
    installHint:
      "download from https://github.com/zed-industries/codex-acp/releases and place on PATH",
    homepage: "https://github.com/zed-industries/codex-acp",
    configOptions: CODEX_CONFIG_OPTIONS,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    spec: { command: registryShimName("gemini"), args: ["--acp"] },
    registryId: "gemini",
    installSource: "registry",
    installHint: "npm install -g @google/gemini-cli",
    homepage: "https://github.com/google-gemini/gemini-cli",
  },
  {
    id: "opencode",
    label: "OpenCode",
    spec: { command: registryShimName("opencode"), args: ["acp"] },
    registryId: "opencode",
    installSource: "registry",
    installHint:
      "npm install -g opencode-ai@latest  # or curl -fsSL https://opencode.ai/install | bash",
    homepage: "https://opencode.ai/",
  },
  {
    id: "cursor",
    label: "Cursor",
    spec: { command: registryShimName("cursor"), args: ["acp"] },
    registryId: "cursor",
    installSource: "registry",
    homepage: "https://cursor.com/docs/cli/acp",
  },
  {
    id: "qwen-code",
    label: "Qwen Code",
    spec: { command: registryShimName("qwen-code"), args: ["--acp", "--experimental-skills"] },
    registryId: "qwen-code",
    installSource: "registry",
    homepage: "https://github.com/QwenLM/qwen-code",
  },
  {
    id: "github-copilot-cli",
    label: "GitHub Copilot",
    spec: { command: registryShimName("github-copilot-cli"), args: ["--acp"] },
    registryId: "github-copilot-cli",
    installSource: "registry",
    homepage: "https://github.com/github/copilot-cli",
  },
  {
    id: "kilo",
    label: "Kilo",
    spec: { command: registryShimName("kilo"), args: ["acp"] },
    registryId: "kilo",
    installSource: "registry",
    homepage: "https://kilo.ai/",
  },
  {
    id: "grok-build",
    label: "Grok Build",
    spec: { command: registryShimName("grok-build"), args: ["agent", "stdio"] },
    registryId: "grok-build",
    installSource: "registry",
    homepage: "https://github.com/xai-org/grok-cli",
  },
  {
    id: "amp-acp",
    label: "Amp",
    spec: { command: registryShimName("amp-acp") },
    registryId: "amp-acp",
    installSource: "registry",
    homepage: "https://github.com/tao12345666333/amp-acp",
  },
  {
    id: "goose",
    label: "Goose",
    spec: { command: registryShimName("goose"), args: ["acp"] },
    registryId: "goose",
    installSource: "registry",
    homepage: "https://block.github.io/goose/",
  },
  {
    id: "cline",
    label: "Cline",
    spec: { command: registryShimName("cline"), args: ["--acp"] },
    registryId: "cline",
    installSource: "registry",
    homepage: "https://cline.bot/",
  },
  {
    id: "auggie",
    label: "Auggie CLI",
    spec: { command: registryShimName("auggie"), args: ["--acp"] },
    registryId: "auggie",
    installSource: "registry",
    homepage: "https://www.augmentcode.com/",
  },
  {
    id: "hermes",
    label: "Hermes",
    spec: { command: "hermes", args: ["acp"] },
    featured: true,
    systemPath: true,
    installHint:
      "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
    homepage: "https://github.com/NousResearch/hermes-agent",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    spec: { command: "openclaw", args: ["acp"] },
    featured: true,
    systemPath: true,
    installHint: "npm install -g openclaw",
    homepage: "https://github.com/openclaw/openclaw",
  },
];

export function resolveOverlayAgent(id: string): KnownAgentEntry | null {
  for (const e of OVERLAY_AGENTS) if (e.id === id) return e;
  return null;
}
