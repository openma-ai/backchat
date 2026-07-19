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
  InlineComposerOptionControls,
  PlanSessionState,
} from "./ComposerSessionControls";

describe("PlanSessionState", () => {
  it("renders only when the collaboration mode is plan", () => {
    const defaultHtml = renderToStaticMarkup(
      <PlanSessionState
        configOptions={[
          {
            id: "collaboration_mode",
            name: "Collaboration mode",
            type: "select",
            currentValue: "default",
            options: [
              { value: "default", name: "Default" },
              { value: "plan", name: "Plan" },
            ],
          },
        ]}
      />,
    );
    const planHtml = renderToStaticMarkup(
      <PlanSessionState
        configOptions={[
          {
            id: "collaboration_mode",
            name: "Collaboration mode",
            type: "select",
            currentValue: "plan",
            options: [
              { value: "default", name: "Default" },
              { value: "plan", name: "Plan" },
            ],
          },
        ]}
      />,
    );

    expect(defaultHtml).toBe("");
    expect(planHtml).toContain("Plan");
    expect(planHtml).toContain('title="Plan mode is active"');
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
