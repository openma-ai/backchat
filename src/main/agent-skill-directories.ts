/**
 * Project-scoped skill directories from the `skills` npm registry.
 *
 * ACP does not standardize skill discovery. BackChat therefore adapts the
 * active registry agent id to the directory that agent already watches in
 * its cwd. Keep this table complete so newly enabled BackChat/plugin skills
 * do not silently become Codex-only.
 */
export const AGENT_SKILL_DIRECTORIES = {
  "aider-desk": ".aider-desk/skills",
  amp: ".agents/skills",
  antigravity: ".agents/skills",
  "antigravity-cli": ".agents/skills",
  astrbot: "data/skills",
  "autohand-code": ".autohand/skills",
  augment: ".augment/skills",
  bob: ".bob/skills",
  "claude-code": ".claude/skills",
  openclaw: "skills",
  cline: ".agents/skills",
  "codearts-agent": ".codeartsdoer/skills",
  codebuddy: ".codebuddy/skills",
  codemaker: ".codemaker/skills",
  codestudio: ".codestudio/skills",
  codex: ".agents/skills",
  "command-code": ".commandcode/skills",
  continue: ".continue/skills",
  cortex: ".cortex/skills",
  crush: ".crush/skills",
  cursor: ".agents/skills",
  deepagents: ".agents/skills",
  devin: ".devin/skills",
  dexto: ".agents/skills",
  droid: ".factory/skills",
  eve: "agent/skills",
  firebender: ".agents/skills",
  forgecode: ".forge/skills",
  "gemini-cli": ".agents/skills",
  "github-copilot": ".agents/skills",
  goose: ".goose/skills",
  grok: ".grok/skills",
  "hermes-agent": ".hermes/skills",
  "inference-sh": ".inferencesh/skills",
  jazz: ".jazz/skills",
  junie: ".junie/skills",
  "iflow-cli": ".iflow/skills",
  kilo: ".kilocode/skills",
  kimchi: ".kimchi/skills",
  "kimi-code-cli": ".agents/skills",
  kiro: ".kiro/skills",
  kode: ".kode/skills",
  lingma: ".lingma/skills",
  loaf: ".agents/skills",
  mcpjam: ".mcpjam/skills",
  "mistral-vibe": ".vibe/skills",
  moxby: ".moxby/skills",
  mux: ".mux/skills",
  opencode: ".agents/skills",
  openhands: ".openhands/skills",
  ona: ".ona/skills",
  pi: ".pi/skills",
  qoder: ".qoder/skills",
  "qoder-cn": ".qoder/skills",
  "qwen-code": ".qwen/skills",
  replit: ".agents/skills",
  reasonix: ".reasonix/skills",
  rovodev: ".rovodev/skills",
  roo: ".roo/skills",
  "tabnine-cli": ".tabnine/agent/skills",
  terramind: ".terramind/skills",
  tinycloud: ".tinycloud/skills",
  trae: ".trae/skills",
  "trae-cn": ".trae/skills",
  warp: ".agents/skills",
  windsurf: ".windsurf/skills",
  zed: ".agents/skills",
  zcode: ".zcode/skills",
  zencoder: ".zencoder/skills",
  zenflow: ".zencoder/skills",
  neovate: ".neovate/skills",
  pochi: ".pochi/skills",
  promptscript: ".agents/skills",
  adal: ".adal/skills",
  universal: ".agents/skills",
} as const satisfies Record<string, string>;

const ACP_AGENT_ALIASES: Record<string, keyof typeof AGENT_SKILL_DIRECTORIES> = {
  "amp-acp": "amp",
  auggie: "augment",
  "claude-acp": "claude-code",
  "claude-agent-acp": "claude-code",
  "claude-code-acp": "claude-code",
  "codex-acp": "codex",
  "codex-acp-bridge": "codex",
  "codex-cli": "codex",
  gemini: "gemini-cli",
  "github-copilot-cli": "github-copilot",
  "grok-build": "grok",
  hermes: "hermes-agent",
};

export function skillDirectoryForAgent(agentId: string): string {
  const normalized = agentId.trim().toLocaleLowerCase();
  const registryId = ACP_AGENT_ALIASES[normalized] ?? normalized;
  return AGENT_SKILL_DIRECTORIES[
    registryId as keyof typeof AGENT_SKILL_DIRECTORIES
  ] ?? AGENT_SKILL_DIRECTORIES.universal;
}
