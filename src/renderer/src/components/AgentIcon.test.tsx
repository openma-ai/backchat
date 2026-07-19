import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lobehub/icons/es/Codex", () => ({ default: () => null }));
vi.mock("@lobehub/icons/es/HermesAgent", () => ({ default: () => null }));
vi.mock("@lobehub/icons/es/OpenClaw", () => ({ default: () => null }));
vi.mock("@lobehub/icons/es/OpenCode", () => ({ default: () => null }));

import { AgentIcon } from "./AgentIcon";

describe("AgentIcon", () => {
  it("renders the official pi ACP mark instead of the generic bot fallback", () => {
    const markup = renderToStaticMarkup(
      <AgentIcon agentId="pi-acp" title="pi ACP" />,
    );

    expect(markup).toContain('viewBox="0 0 16 16"');
    expect(markup).toContain(
      "M1 1H11.7692V7.9999H8.17942V11.4999H4.58982V15H1V1Z",
    );
    expect(markup).not.toContain("lucide-bot");
  });
});
