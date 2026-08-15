import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lobehub/icons/es/Codex", () => ({ default: () => null }));
vi.mock("@lobehub/icons/es/DeepSeek", () => ({
  default: ({ className }: { className?: string }) => <svg className={className} />,
}));
vi.mock("@lobehub/icons/es/HermesAgent", () => ({ default: () => null }));
vi.mock("@lobehub/icons/es/OpenClaw", () => ({ default: () => null }));
vi.mock("@lobehub/icons/es/OpenCode", () => ({ default: () => null }));

import { AgentIcon } from "./AgentIcon";

describe("AgentIcon", () => {
  it("renders the DeepSeek brand mark for DeepSeek Harness", () => {
    const html = renderToStaticMarkup(
      <AgentIcon agentId="dsh-acp" title="DeepSeek Harness" />,
    );

    expect(html).toContain('aria-label="DeepSeek Harness"');
    expect(html).toContain('data-agent-icon-source="deepseek"');
    expect(html).not.toContain("lucide-bot");
  });

  it("keeps the bundled Claude icon when a registry icon URL is present", () => {
    const html = renderToStaticMarkup(
      <AgentIcon
        agentId="claude-acp"
        iconUrl="https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg"
        title="Claude"
      />,
    );

    expect(html).toContain('aria-label="Claude"');
    expect(html).toContain('data-agent-icon-source="bundled"');
    expect(html).not.toContain('data-agent-icon-source="registry"');
    expect(html).not.toContain("https://cdn.agentclientprotocol.com");
  });
});
