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

export const OVERLAY_AGENTS: KnownAgentEntry[] = [
  {
    id: "claude-acp",
    label: "Claude Agent",
    spec: { command: "claude-agent-acp" },
    featured: true,
    wraps: "claude",
    install: { kind: "npm", package: "@agentclientprotocol/claude-agent-acp" },
    installHint: "npm install -g @agentclientprotocol/claude-agent-acp",
    homepage: "https://github.com/agentclientprotocol/claude-agent-acp",
  },
  {
    id: "codex-acp",
    label: "Codex CLI",
    spec: { command: "codex-acp" },
    featured: true,
    wraps: "codex",
    installHint:
      "download from https://github.com/zed-industries/codex-acp/releases and place on PATH",
    homepage: "https://github.com/zed-industries/codex-acp",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    spec: { command: "gemini", args: ["--acp"] },
    installHint: "npm install -g @google/gemini-cli",
    homepage: "https://github.com/google-gemini/gemini-cli",
  },
  {
    id: "opencode",
    label: "OpenCode",
    spec: { command: "opencode", args: ["acp"] },
    installHint:
      "npm install -g opencode-ai@latest  # or curl -fsSL https://opencode.ai/install | bash",
    homepage: "https://opencode.ai/",
  },
  {
    id: "hermes",
    label: "Hermes",
    spec: { command: "hermes", args: ["acp"] },
    featured: true,
    installHint:
      "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
    homepage: "https://github.com/NousResearch/hermes-agent",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    spec: { command: "openclaw", args: ["acp"] },
    featured: true,
    installHint: "npm install -g openclaw",
    homepage: "https://github.com/openclaw/openclaw",
  },
];

export function resolveOverlayAgent(id: string): KnownAgentEntry | null {
  for (const e of OVERLAY_AGENTS) if (e.id === id) return e;
  return null;
}
