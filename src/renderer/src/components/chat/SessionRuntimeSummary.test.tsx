import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionRow } from "@/lib/session-store";
import { SessionRuntimeSummary } from "./SessionRuntimeSummary";

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-runtime",
    agent_id: "kimi-code-acp",
    acp_session_id: "acp-runtime",
    cwd: "/work/primary",
    additionalDirectories: ["/work/docs", "/work/packages"],
    label: "Runtime evidence",
    status: "ready",
    createdAt: 1,
    protocolVersion: 1,
    agentInfo: { name: "Kimi Code CLI", version: "0.33.0" },
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true },
    },
    supportsSessionClose: true,
    usage: {
      used: 1_234,
      size: 8_192,
      cost: { amount: 0.42, currency: "USD" },
    },
    goal: { objective: "Verify every harness", status: "active" },
    ...overrides,
  };
}

describe("SessionRuntimeSummary", () => {
  it("renders initialize, workspace, parent usage, and status evidence in visible GUI slots", () => {
    const html = renderToStaticMarkup(
      <SessionRuntimeSummary session={row()} queueDepth={2} />,
    );

    expect(html).toContain('data-gui-feature="session.initialize-ready"');
    expect(html).toContain('data-gui-feature="session.new-workspace"');
    expect(html).toContain('aria-label="Session status: Idle"');
    expect(html).toContain('data-session-status="idle"');
    expect(html).toContain("Kimi Code");
    expect(html).toContain("0.33.0");
    expect(html).toContain("/work/primary");
    expect(html).toContain("/work/docs");
    expect(html).toContain('data-session-capability="promptCapabilities.image"');
    expect(html).toContain('data-session-capability="session.close"');
    expect(html).toContain('data-gui-feature="output.usage-parent"');
    expect(html).toContain('data-usage-scope="parent"');
    expect(html).toContain("Context · 1,234 / 8,192 tokens · 0.42 USD");
    expect(html).toContain("Queue 2");
    expect(html).toContain("Goal Verify every harness · active");
  });

  it("renders a terminated state with an explicit disabled marker", () => {
    const html = renderToStaticMarkup(
      <SessionRuntimeSummary session={row({ status: "disposed" })} />,
    );

    expect(html).toContain('aria-label="Session status: Terminated"');
    expect(html).toContain('data-gui-feature="session.close-terminated"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Composer disabled");
  });

  it("renders the required accessible Running state", () => {
    const html = renderToStaticMarkup(
      <SessionRuntimeSummary session={row({ status: "running" })} />,
    );

    expect(html).toContain('aria-label="Session status: Running"');
    expect(html).toContain('data-session-status="running"');
  });
});
