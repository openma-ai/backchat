/**
 * Agent icon helper.
 *
 * Brand marks via @lobehub/icons (LLM-specific single-color SVG library):
 *   - Claude / Gemini still via simple-icons (cleaner Anthropic / Google
 *     marks than LobeHub's)
 *   - Codex / OpenCode / Hermes / OpenClaw via LobeHub `.Mono` (the
 *     monochrome currentColor variant)
 *
 * Color: currentColor everywhere so the icon inherits its host's text
 * color (text-fg-muted by default).
 */

import { siClaude, siGooglegemini } from "simple-icons";
import { BotIcon } from "lucide-react";
import CodexIcon from "@lobehub/icons/es/Codex";
import HermesAgentIcon from "@lobehub/icons/es/HermesAgent";
import OpenClawIcon from "@lobehub/icons/es/OpenClaw";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode";

type SimpleIcon = { path: string; title: string };

const SIMPLE: Record<string, SimpleIcon> = {
  "claude-acp": siClaude,
  "gemini": siGooglegemini,
};

type LobeIcon = React.ComponentType<{ size?: number | string; className?: string }>;
const LOBE: Record<string, LobeIcon> = {
  "codex-acp": CodexIcon as unknown as LobeIcon,
  opencode: OpenCodeIcon as unknown as LobeIcon,
  hermes: HermesAgentIcon as unknown as LobeIcon,
  openclaw: OpenClawIcon as unknown as LobeIcon,
};

/** React component that renders the icon for an agent id. Sized via the
 *  `size` class on the wrapper. */
export function AgentIcon({
  agentId,
  className = "size-3.5",
  title,
}: {
  agentId: string;
  className?: string;
  title?: string;
}) {
  if (agentId === "pi-acp") {
    return (
      <svg
        role="img"
        aria-label={title ?? "pi ACP"}
        viewBox="0 0 16 16"
        fill="currentColor"
        className={className}
      >
        <path d="M1 1H11.7692V7.9999H8.17942V11.4999H4.58982V15H1V1ZM4.58982 4.50005V7.9999H8.17942V4.50005H4.58982Z" />
        <path d="M11.7692 7.46154H15V15H11.7692V7.46154Z" />
      </svg>
    );
  }
  const si = SIMPLE[agentId];
  if (si) {
    return (
      <svg
        role="img"
        aria-label={title ?? si.title}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
      >
        <path d={si.path} />
      </svg>
    );
  }
  const Lobe = LOBE[agentId];
  if (Lobe) {
    return <Lobe className={className} aria-label={title ?? agentId} />;
  }
  return <BotIcon className={className} aria-label={title ?? agentId} />;
}
