/**
 * Agent icon helper.
 *
 * Each known ACP agent gets an icon: simple-icons SVG path when the
 * brand is in the registry (Claude, OpenAI Codex, Gemini), or a lucide
 * fallback for the long tail (OpenCode, Hermes, OpenClaw — projects too
 * young/small to have shipped marks into simple-icons yet).
 *
 * Color: render with `currentColor` so the icon inherits its host's
 * text color. We want the chrome to be quiet (text-fg-muted by default),
 * not a brand-colored splash — that decision came from the sidebar
 * iteration where every row turned into a Christmas tree of orange/blue
 * marks. Black/grey reads as competent, not promotional.
 */

import { siClaude, siGooglegemini, siZedindustries } from "simple-icons";
import {
  BotIcon,
  CommandIcon,
  type LucideIcon,
  TerminalIcon,
} from "lucide-react";

type SimpleIcon = { path: string; title: string };

const SIMPLE: Record<string, SimpleIcon> = {
  "claude-acp": siClaude,
  // codex-acp ships from Zed Industries (the editor team). Their wordmark
  // is in simple-icons; OpenAI's own slug isn't (the brand pulled it).
  "codex-acp": siZedindustries,
  "gemini": siGooglegemini,
};

const LUCIDE: Record<string, LucideIcon> = {
  opencode: TerminalIcon,
  hermes: BotIcon,
  openclaw: CommandIcon,
};

/** React component that renders the icon for an agent id. Sized via the
 *  `size` class on the wrapper (lucide is sized by Tailwind `size-*`;
 *  simple-icons inline SVG inherits the same box). */
export function AgentIcon({
  agentId,
  className = "size-3.5",
  title,
}: {
  agentId: string;
  className?: string;
  title?: string;
}) {
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
  const Lu = LUCIDE[agentId] ?? BotIcon;
  return <Lu className={className} aria-label={title ?? agentId} />;
}
