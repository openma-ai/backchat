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
    })[key] ?? key,
  }),
}));

vi.mock("@/lib/settings-store", () => ({
  useSettings: () => undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

import {
  ComposerSessionStateSlot,
  InlineComposerOptionControls,
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
});
