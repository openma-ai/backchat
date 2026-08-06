import { describe, expect, it } from "vitest";

import {
  createOpenMAEvent,
  type CanonicalEventType,
} from "@openma/common/session-events/openma";

import {
  composerActivityModules,
  composerActivityModulesForSession,
} from "./composer-activity-dock";

const labels = {
  plan: "Plan",
  monitor: "Monitor",
  background: "Background",
  elicitation: "External interaction",
  elicitationComplete: "Completed external interaction",
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

  it("keeps permission, filesystem, form, and URL callback decisions as durable GUI activity", () => {
    const callbackEvent = (
      eventId: string,
      type: CanonicalEventType,
      data: Record<string, unknown>,
    ) => createOpenMAEvent({
      event_id: eventId,
      type,
      session_id: "sess-callbacks",
      source: { kind: "user" },
      occurred_at: "2026-08-06T10:00:00.000Z",
      data,
    });

    expect(composerActivityModules({
      tasks: [],
      workItems: [],
      openmaEvents: [
        callbackEvent("permission-1", "user.permission_response", {
          request_id: "perm-1",
          outcome: "selected",
          option_id: "allow-once",
        }),
        callbackEvent("filesystem-1", "user.fs_write_response", {
          request_id: "fsw-1",
          outcome: "denied",
          path: "/tmp/outside/matrix-output.txt",
        }),
        callbackEvent("form-1", "user.elicitation_response", {
          request_id: "form-1",
          action: "accept",
          content: { strategy: "strict" },
        }),
        callbackEvent("url-1", "user.elicitation_response", {
          request_id: "url-1",
          action: "decline",
          mode: "url",
          elicitation_id: "matrix-url-1",
        }),
      ],
      labels,
    })).toEqual([{
      id: "callbacks",
      kind: "callbacks",
      label: "Callback decisions",
      summary: "4 decisions",
      items: [
        {
          id: "callback:permission:permission-1",
          label: "Permission",
          status: "selected",
          detail: "allow-once",
          variant: "event",
        },
        {
          id: "callback:filesystem:filesystem-1",
          label: "File write",
          status: "denied",
          detail: "/tmp/outside/matrix-output.txt",
          variant: "event",
        },
        {
          id: "callback:form:form-1",
          label: "Form",
          status: "accept",
          detail: "strategy: strict",
          variant: "event",
        },
        {
          id: "callback:url:url-1",
          label: "External page",
          status: "decline",
          detail: "matrix-url-1",
          variant: "event",
        },
      ],
    }]);
  });

  it("projects URL elicitation completion as an explicit GUI activity", () => {
    const accepted = createOpenMAEvent({
      event_id: "elicitation-accepted-1",
      type: "user.elicitation_response",
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "user" },
      occurred_at: "2026-08-06T09:59:00.000Z",
      data: {
        request_id: "elicit-url-1",
        action: "accept",
        mode: "url",
        elicitation_id: "github-oauth-001",
      },
    });
    const completion = createOpenMAEvent({
      event_id: "elicitation-complete-1",
      type: "callback.notification",
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "harness", harness: "claude-acp", adapter: "claude" },
      occurred_at: "2026-08-06T10:00:00.000Z",
      data: {
        method: "elicitation/complete",
        category: "elicitation",
        params: { elicitationId: "github-oauth-001" },
      },
    });

    expect(composerActivityModules({
      tasks: [],
      workItems: [],
      openmaEvents: [accepted, completion],
      labels,
    })).toEqual([
      {
        id: "callbacks",
        kind: "callbacks",
        label: "Callback decisions",
        summary: "1 decision",
        items: [{
          id: "callback:url:elicitation-accepted-1",
          label: "External page",
          status: "accept",
          detail: "github-oauth-001",
          variant: "event",
        }],
      },
      {
        id: "elicitation",
        kind: "elicitation",
        label: "External interaction",
        summary: "1 completed",
        items: [{
          id: "elicitation:elicitation-complete-1",
          label: "Completed external interaction",
          status: "completed",
          detail: "github-oauth-001",
          variant: "event",
        }],
      },
    ]);
  });

  it("does not surface unknown or duplicate URL completion identities", () => {
    const accepted = createOpenMAEvent({
      event_id: "elicitation-accepted-2",
      type: "user.elicitation_response",
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "user" },
      occurred_at: "2026-08-06T09:59:00.000Z",
      data: {
        request_id: "elicit-url-2",
        action: "accept",
        mode: "url",
        elicitation_id: "known-id",
      },
    });
    const completion = (id: string, elicitationId: string) => createOpenMAEvent({
      event_id: id,
      type: "callback.notification",
      session_id: "sess-1",
      turn_id: "turn-1",
      source: { kind: "harness", harness: "claude-acp", adapter: "claude" },
      occurred_at: "2026-08-06T10:00:00.000Z",
      data: {
        method: "elicitation/complete",
        category: "elicitation",
        params: { elicitationId },
      },
    });

    const [module] = composerActivityModules({
      tasks: [],
      workItems: [],
      openmaEvents: [
        accepted,
        completion("unknown", "unknown-id"),
        completion("known-first", "known-id"),
        completion("known-duplicate", "known-id"),
      ],
      labels,
    });
    expect(module?.items).toHaveLength(1);
    expect(module?.items[0]?.detail).toBe("known-id");
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
