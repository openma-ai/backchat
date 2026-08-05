import { describe, expect, it } from "vitest";

import { createOpenMAEvent } from "@openma/common/session-events/openma";

import {
  composerActivityModules,
  composerActivityModulesForSession,
} from "./composer-activity-dock";

const labels = {
  plan: "Plan",
  monitor: "Monitor",
  background: "Background",
  running: "running",
  completed: "completed",
  event: "event",
  events: "events",
};

describe("composerActivityModules", () => {
  it("keeps Plan, Monitor, and other background work as independent dock modules", () => {
    expect(
      composerActivityModules({
        tasks: [
          { content: "Inspect events", status: "completed" },
          { content: "Watch the build", status: "in_progress" },
        ],
        workItems: [
          {
            id: "monitor-1",
            kind: "monitor",
            status: "running",
            title: "Watch CI until it settles",
            output: [],
          },
          {
            id: "bash-1",
            kind: "bash",
            status: "completed",
            title: "pnpm test",
            output: [],
          },
        ],
        openmaEvents: [
          createOpenMAEvent({
            event_id: "monitor-event-1",
            type: "monitor.event",
            session_id: "sess-1",
            turn_id: "turn-1",
            source: { kind: "harness", harness: "claude-acp", adapter: "claude" },
            occurred_at: "2026-08-05T10:00:00.000Z",
            data: {
              description: "errors in deploy.log",
              text: "ERROR timeout",
            },
          }),
        ],
        labels,
      }),
    ).toEqual([
      {
        id: "plan",
        kind: "plan",
        label: "Plan",
        summary: "1 / 2",
        items: [
          { id: "plan:0", label: "Inspect events", status: "completed" },
          { id: "plan:1", label: "Watch the build", status: "in_progress" },
        ],
      },
      {
        id: "monitor",
        kind: "monitor",
        label: "Monitor",
        summary: "1 running · 1 event",
        items: [
          {
            id: "monitor-1",
            label: "Watch CI until it settles",
            status: "running",
            variant: "subscription",
          },
          {
            id: "monitor:event:monitor-event-1",
            label: "errors in deploy.log",
            status: "event",
            detail: "ERROR timeout",
            variant: "event",
          },
        ],
      },
      {
        id: "background",
        kind: "background",
        label: "Background",
        summary: "1 completed",
        items: [
          {
            id: "bash-1",
            label: "pnpm test",
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("does not invent modules when no structured activity exists", () => {
    expect(composerActivityModules({
      tasks: [],
      workItems: [],
      openmaEvents: [],
      labels,
    })).toEqual([]);
  });

  it("reads the latest ACP task list for the session Plan module", () => {
    expect(composerActivityModulesForSession({
      agentId: "claude-acp",
      turns: [{
        events: [{
          payload: {
            sessionUpdate: "plan",
            entries: [
              { content: "Inspect SDK", status: "completed" },
              { content: "Wire Activity Dock", status: "in_progress" },
            ],
          },
        }],
      } as never],
      workItems: [],
      openmaEvents: [],
      labels,
    })).toEqual([
      expect.objectContaining({
        id: "plan",
        summary: "1 / 2",
        items: [
          { id: "plan:0", label: "Inspect SDK", status: "completed" },
          { id: "plan:1", label: "Wire Activity Dock", status: "in_progress" },
        ],
      }),
    ]);
  });
});
