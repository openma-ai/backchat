const HARNESS_LABELS: Record<string, string> = {
  "claude-acp": "Claude",
  "codex-acp": "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
  "qwen-code": "Qwen Code",
  "github-copilot-cli": "GitHub Copilot",
  kilo: "Kilo",
  "grok-build": "Grok Build",
  "amp-acp": "Amp",
  goose: "Goose",
  cline: "Cline",
  auggie: "Auggie CLI",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

export function harnessDisplayName(harnessId: string): string {
  return HARNESS_LABELS[harnessId] ?? harnessId.replace(/-acp$/i, "");
}
