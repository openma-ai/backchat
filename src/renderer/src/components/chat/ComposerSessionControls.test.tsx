import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "chat.plan": "Plan",
      "chat.planActiveHint": "Plan mode is active",
      "chat.goalStatus": "Goal",
      "chat.signIn": "Sign in",
      "chat.refreshAuth": "Check sign-in",
    })[key] ?? key,
  }),
}));

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

import {
  ComposerAuthControls,
  ComposerSessionStateSlot,
  InlineComposerOptionControls,
  SessionRunChip,
} from "./ComposerSessionControls";

describe("ComposerSessionStateSlot", () => {
  it("renders Plan Mode in the same generic slot used by Goal", () => {
    const planHtml = renderToStaticMarkup(
      <ComposerSessionStateSlot
        presentation={{
          id: "mode:claude-acp:plan",
          kind: "plan_mode",
          label: "Plan",
          title: "Plan mode is active",
          icon: "plan",
        }}
      />,
    );
    const goalHtml = renderToStaticMarkup(
      <ComposerSessionStateSlot
        presentation={{
          id: "goal:ship",
          kind: "goal",
          label: "Goal",
          title: "Ship goal UI",
          icon: "goal",
        }}
      />,
    );

    expect(planHtml).toContain('data-composer-session-state="true"');
    expect(planHtml).toContain('data-session-state-kind="plan_mode"');
    expect(planHtml).toContain("Plan");
    expect(planHtml).toContain('title="Plan mode is active"');
    expect(planHtml).toContain("lucide-lightbulb");
    expect(goalHtml).toContain('data-session-state-kind="goal"');
    expect(goalHtml).toContain("Goal");
    expect(goalHtml).toContain("lucide-target");
  });
});

describe("InlineComposerOptionControls", () => {
  it("renders a boolean custom option with its current pressed state", () => {
    const html = renderToStaticMarkup(
      <InlineComposerOptionControls
        disabled={false}
        configOptions={[
          {
            id: "telemetry",
            name: "Telemetry",
            type: "boolean",
            currentValue: true,
          },
        ]}
        onSetConfigOption={() => undefined}
      />,
    );

    expect(html).toContain("Telemetry");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("disabled");
  });

  it("renders the Agent option like permission: icon plus current name, per-option icons in the menu", () => {
    const html = renderToStaticMarkup(
      <InlineComposerOptionControls
        disabled={false}
        configOptions={[
          {
            id: "agent",
            name: "Agent",
            type: "select",
            currentValue: "standard",
            options: [
              { value: "standard", name: "Standard", description: 'Agent preset “standard”' },
              { value: "code", name: "Code", description: 'Agent preset “code”' },
              { value: "minimal", name: "Minimal", description: 'Agent preset “minimal”' },
              { value: "cordis", name: "Cordis", description: 'Agent preset “cordis”' },
            ],
          },
        ]}
        onSetConfigOption={() => undefined}
      />,
    );

    expect(html).toContain("lucide-chevron-down");
    expect(html).toContain("Standard");
    expect(html).toContain('data-dsh-preset-icon="standard"');
    expect(html).toContain('data-dsh-preset-icon="code"');
    expect(html).toContain('data-dsh-preset-icon="minimal"');
    expect(html).toContain('data-dsh-preset-icon="cordis"');
    expect(html).not.toContain("lucide-bot");
    expect(html).not.toContain("lucide-terminal");
    expect(html).not.toContain("lucide-minus");
    expect(html).not.toContain("lucide-puzzle");
    expect(html).not.toContain("lucide-wrench");
    expect(html).not.toContain("Agent preset");
    expect(html).not.toContain('class="truncate">Agent<');
  });

  it("keeps the Agent preset chip idle at rest, like permission", () => {
    const html = renderToStaticMarkup(
      <InlineComposerOptionControls
        disabled={false}
        configOptions={[
          {
            id: "agent",
            name: "Agent",
            type: "select",
            currentValue: "standard",
            options: [
              { value: "standard", name: "Standard" },
              { value: "code", name: "Code" },
            ],
          },
        ]}
        onSetConfigOption={() => undefined}
      />,
    );
    const trigger = html.match(/<button\b[^>]*aria-label="Standard"[^>]*>/)?.[0];

    expect(trigger).toContain("bg-transparent");
    expect(trigger).not.toContain("focus-visible:bg-");
    expect(trigger).not.toMatch(/(?<![^\s"'])bg-\[var\(--control-bg-(?:hover|open)\)\]/);
  });
});

describe("SessionRunChip", () => {
  it("does not expose local agent command paths in the harness menu", () => {
    const command = "/Users/test/.oma/acp/bin/claude-agent-acp";
    const html = renderToStaticMarkup(
      <SessionRunChip
        disabled={false}
        locked={false}
        agents={[{
          id: "claude",
          label: "Claude",
          command,
          detected: true,
        }]}
        currentAgentId="claude"
        onPickAgent={() => undefined}
        onSetConfigOption={() => undefined}
      />,
    );

    expect(html).toContain("Claude");
    expect(html).not.toContain(command);
    expect(html).not.toContain("/.oma/acp/bin/");
  });

  it("offers a direct reset to the ACP-declared config defaults", () => {
    const html = renderToStaticMarkup(
      <SessionRunChip
        disabled={false}
        locked={false}
        agents={[{
          id: "kilo",
          label: "Kilo",
          command: "kilo",
          detected: true,
        }]}
        currentAgentId="kilo"
        configOptions={[{
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "kilo/nano-banana",
          options: [
            { value: "anthropic/deepseek-v4-flash", name: "Anthropic/DeepSeek V4 Flash" },
            { value: "kilo/nano-banana", name: "Kilo/Nano Banana" },
          ],
        }]}
        onPickAgent={() => undefined}
        onSetConfigOption={() => undefined}
        onResetConfigOptions={() => undefined}
      />,
    );

    expect(html).toContain("chat.resetToDefault");
  });

  it("turns the harness label danger when authentication is required", () => {
    const html = renderToStaticMarkup(
      <SessionRunChip
        disabled={false}
        locked={false}
        authNeeded
        agents={[{
          id: "dsh-acp",
          label: "DeepSeek Harness",
          command: "dsh-acp",
          detected: true,
        }]}
        currentAgentId="dsh-acp"
        currentAgentLabel="DeepSeek Harness"
        configOptions={[{
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "GPT-5.3-Codex-Spark",
          options: [{ value: "GPT-5.3-Codex-Spark", name: "GPT-5.3-Codex-Spark" }],
        }]}
        onPickAgent={() => undefined}
        onSetConfigOption={() => undefined}
      />,
    );

    expect(html).toContain("text-danger");
    expect(html).toContain("GPT-5.3-Codex-Spark");
  });
});

describe("ComposerAuthControls", () => {
  it("labels the door with visible sign-in copy instead of a tooltip", () => {
    const html = renderToStaticMarkup(
      <ComposerAuthControls
        authNeeded
        refreshing={false}
        onSignIn={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain("data-composer-auth-signin");
    expect(html).toContain("data-composer-auth-refresh");
    expect(html).toContain("<span>Sign in</span>");
    expect(html).not.toContain('data-slot="tooltip-trigger"');
    expect(html.indexOf("data-composer-auth-refresh")).toBeLessThan(
      html.indexOf("data-composer-auth-signin"),
    );

    const source = readFileSync(resolve(__dirname, "ComposerSessionControls.tsx"), "utf8");
    const block = source.slice(
      source.indexOf("export function ComposerAuthControls"),
      source.indexOf("export function runtimePresentation"),
    );
    expect(block).not.toContain("Tooltip");
    expect(block).toContain('t("chat.signIn")');
  });

  it("hides sign-in and refresh when the harness is already signed in", () => {
    const html = renderToStaticMarkup(
      <ComposerAuthControls
        authNeeded={false}
        refreshing={false}
        onSignIn={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toBe("");
  });

  it("disables refresh and sign-in while a probe is in flight", () => {
    const html = renderToStaticMarkup(
      <ComposerAuthControls
        authNeeded
        refreshing
        onSignIn={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toMatch(/data-composer-auth-refresh[\s\S]*disabled/);
    expect(html).toMatch(/data-composer-auth-signin[\s\S]*disabled/);
  });
});
