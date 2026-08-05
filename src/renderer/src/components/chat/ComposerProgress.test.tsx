import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "chat.stepProgress") {
        return `Step ${String(values?.current)} / ${String(values?.total)}`;
      }
      const labels: Record<string, string> = {
        "chat.plan": "Plan",
        "chat.goalActive": "Pursuing goal",
        "chat.goalPaused": "Goal paused",
        "chat.goalComplete": "Goal complete",
        "chat.goalBlocked": "Goal blocked",
        "chat.goalStatus": "Goal",
        "chat.dismissProgress": "Dismiss progress",
        "chat.pauseProgress": "Pause progress",
        "chat.resumeProgress": "Resume progress",
      };
      return labels[key] ?? key;
    },
  }),
}));

import { ComposerProgress, ProgressItemList } from "./ComposerProgress";

describe("ComposerProgress", () => {
  it("renders a generic composer progress presentation without a goal", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        presentation={{
          id: "command:tests",
          kind: "command",
          label: "Running command",
          title: "pnpm test",
          status: "active",
          icon: "command",
          items: [],
        }}
      />,
    );

    expect(html).toContain('data-progress-kind="command"');
    expect(html).toContain("Running command");
    expect(html).toContain("pnpm test");
  });

  it("renders explicitly bound items for a progress presentation", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        presentation={{
          id: "goal:ship-progress",
          kind: "goal",
          label: "Pursuing goal",
          title: "Ship goal progress UI",
          status: "active",
          icon: "target",
          items: [
            { content: "Inspect events", status: "completed" },
            { content: "Build unified GUI", status: "in_progress" },
            { content: "Capture E2E evidence", status: "pending" },
          ],
          actions: { dismiss: true },
        }}
      />,
    );

    expect(html).toContain('data-composer-progress="true"');
    expect(html).toContain('data-progress-kind="goal"');
    expect(html).toContain('data-goal-status="active"');
    expect(html).toContain('data-current-item="2"');
    expect(html).toContain('data-progress-step-trigger="true"');
    expect(html).toContain('data-progress-cap-viewport="true"');
    expect(html).toContain("overflow-hidden");
    expect(html).toContain('data-progress-banner="true"');
    expect(html).toMatch(
      /data-progress-banner="true" class="[^"]*composer-radius/,
    );
    expect(html).toContain("lucide-target");
    expect(html).toContain("Step 2 / 3");
    expect(html).toContain("Ship goal progress UI");
    expect(html).toContain('aria-label="Dismiss progress"');
  });

  it("renders several independent modules in one activity dock without merging Goal", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        presentation={{
          id: "goal:activity-dock",
          kind: "goal",
          label: "Pursuing goal",
          title: "Ship the activity dock",
          status: "active",
        }}
        activityModules={[
          {
            id: "files",
            kind: "files",
            label: "Files changed",
            summary: "3",
            items: [],
          },
          {
            id: "plan",
            kind: "plan",
            label: "Plan",
            summary: "1 / 3",
            items: [{ id: "plan:0", label: "Inspect", status: "in_progress" }],
          },
          {
            id: "monitor",
            kind: "monitor",
            label: "Monitor",
            summary: "1 running",
            items: [{ id: "monitor-1", label: "Watch CI", status: "running" }],
          },
          {
            id: "background",
            kind: "background",
            label: "Background",
            summary: "2 running",
            items: [],
          },
        ]}
      />,
    );

    expect(html).toContain('data-activity-dock="true"');
    expect(html.match(/data-activity-module=/g)).toHaveLength(3);
    expect(html).toContain('data-activity-module="files"');
    expect(html).toContain('data-activity-module="plan"');
    expect(html).toContain('data-activity-module="monitor"');
    expect(html).toContain('data-activity-overflow="1"');
    expect(html).toContain("+1");
    expect(html).toContain('data-progress-cap-content="true"');
    expect(html.indexOf('data-activity-dock="true"')).toBeLessThan(
      html.indexOf('data-progress-cap-content="true"'),
    );
  });

  it("renders the real prompt queue in the same floating surface as Goal", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        presentation={{
          id: "goal:queue",
          kind: "goal",
          label: "Pursuing goal",
          title: "Ship the queue",
          status: "active",
          icon: "target",
        }}
        queuedPrompts={[
          { turn_id: "turn-2", text: "check the internal logic", created_at: 2 },
          { turn_id: "turn-3", text: "then polish the GUI", created_at: 3 },
        ]}
        queueCallbacks={{
          update: vi.fn(),
          remove: vi.fn(),
          reorder: vi.fn(),
          steer: vi.fn(),
        }}
      />,
    );

    expect(html).toContain('data-composer-progress="true"');
    expect(html).toContain('data-composer-queue="true"');
    expect(html).toContain("Ship the queue");
    expect(html).toContain("check the internal logic");
    expect(html).toContain("then polish the GUI");
    expect(html).toContain('aria-label="Edit queued message 1"');
    expect(html).toContain('aria-label="Steer queued message 1"');
    expect(html).toContain('aria-label="Remove queued message 2"');
    expect(html).toContain('aria-label="Move queued message 2 up"');
  });

  it("renders the queue surface even when no Goal is active", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        queuedPrompts={[
          { turn_id: "turn-2", text: "standalone queue item", created_at: 2 },
        ]}
      />,
    );

    expect(html).toContain('data-composer-queue="true"');
    expect(html).toContain("standalone queue item");
  });

  it("uses the six-dot drag marker and an explicit send-now Steer action", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        queuedPrompts={[
          { turn_id: "turn-2", text: "queued item", created_at: 2 },
        ]}
        queueCallbacks={{ steer: vi.fn() }}
      />,
    );
    const steerStart = html.indexOf('aria-label="Steer queued message 1"');
    const steerEnd = html.indexOf("</button>", steerStart);
    const steerButton = html.slice(steerStart, steerEnd);

    expect(html).toContain('data-queue-leading-icon="drag"');
    expect(html).toContain("lucide-grip-vertical");
    expect(html).not.toContain("lucide-clock-3");
    expect(html).not.toContain("lucide-corner-down-right");
    expect(html).not.toContain("lucide-corner-up-right");
    expect(steerButton).toContain("lucide-send-horizontal");
    expect(steerButton).toContain("Steer");
  });

  it("presents progress items as a checklist rather than a status table", () => {
    const html = renderToStaticMarkup(
      <ProgressItemList
        items={[
          { content: "Inspect events", status: "completed" },
          { content: "Build unified GUI", status: "in_progress" },
          { content: "Capture E2E evidence", status: "pending" },
        ]}
        currentItem={2}
      />,
    );

    expect(html).toContain('data-progress-item-list="true"');
    expect(html).toContain('data-progress-item-status="completed"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Inspect events");
    expect(html).not.toContain("Completed");
    expect(html).not.toContain("Current");
    expect(html).not.toContain("Pending");
    expect(html).not.toContain("plan-progress-index");
    expect(html).not.toContain(">Plan<");
  });

  it("shows a presentation before progress items arrive", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        presentation={{
          id: "goal:wait",
          kind: "goal",
          label: "Goal paused",
          title: "Wait for progress items",
          status: "paused",
          icon: "target",
          items: [],
        }}
      />,
    );

    expect(html).toContain("Goal paused");
    expect(html).toContain('data-current-item="0"');
    expect(html).not.toContain('data-progress-step-trigger="true"');
  });

  it("enables only progress controls supplied by the agent adapter", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        presentation={{
          id: "goal:active",
          kind: "goal",
          label: "Pursuing goal",
          title: "Ship progress controls",
          status: "active",
          actions: { pause: true },
        }}
        callbacks={{ pause: vi.fn() }}
      />,
    );

    expect(html).toMatch(/aria-label="Pause progress"(?![^>]*disabled)/);
  });

  it("renders resume for a paused presentation", () => {
    const html = renderToStaticMarkup(
      <ComposerProgress
        presentation={{
          id: "goal:paused",
          kind: "goal",
          label: "Goal paused",
          title: "Ship progress controls",
          status: "paused",
          actions: { resume: true },
        }}
        callbacks={{ resume: vi.fn() }}
      />,
    );

    expect(html).toContain('aria-label="Resume progress"');
    expect(html).not.toContain('aria-label="Pause progress"');
  });

  it("does not reserve composer space without a goal or plan", () => {
    expect(renderToStaticMarkup(<ComposerProgress />)).toBe("");
  });

  it("does not turn another agent's standalone plan into goal progress", () => {
    expect(
      renderToStaticMarkup(
        <ComposerProgress />,
      ),
    ).toBe("");
  });
});
