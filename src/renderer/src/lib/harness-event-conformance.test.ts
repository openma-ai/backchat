import { describe, expect, it } from "vitest";

import { reduceTurn } from "@openma/common/session-events/acp";
import { toOpenMAEvent } from "@shared/openma-event.js";
import {
  CLAUDE_AGENT_ACP_0_64_2_FIXTURE,
  CODEX_ACP_1_1_9_FIXTURE,
  CURSOR_2026_07_23_FIXTURE,
  KILO_7_4_20_FIXTURE,
  KIMI_1_49_0_FIXTURE,
  OPENCODE_1_18_13_FIXTURE,
  PI_ACP_0_0_33_FIXTURE,
} from "./fixtures/harness-events";
import { SessionStore } from "./session-store";

const coverageDimensions = [
  "capability",
  "commands",
  "modeConfig",
  "plan",
  "usage",
  "sessionStatus",
  "terminalBackground",
  "callback",
  "nativeAgent",
] as const;

const harnessFixtures = [
  CLAUDE_AGENT_ACP_0_64_2_FIXTURE,
  CODEX_ACP_1_1_9_FIXTURE,
  CURSOR_2026_07_23_FIXTURE,
  PI_ACP_0_0_33_FIXTURE,
  OPENCODE_1_18_13_FIXTURE,
  KILO_7_4_20_FIXTURE,
  KIMI_1_49_0_FIXTURE,
] as const;

type CoverageFixture = {
  metadata: { harness: string; harnessVersion: string };
  setup: Record<string, unknown>;
  events: Record<string, unknown>;
  coverage: Record<string, {
    status: string;
    setupKey?: string;
    eventKey?: string;
    expectedCanonicalTypes?: readonly string[];
    guiSlot?: string;
    evidence: readonly { reference: string; claim: string }[];
  }>;
};

const nativeCases = [
  {
    fixture: CLAUDE_AGENT_ACP_0_64_2_FIXTURE,
    agentId: "claude-acp",
    event: CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.subagentTaskStarted,
    canonicalType: "work_item.started",
    childId: "agent-task-42",
    status: "running",
  },
  {
    fixture: CODEX_ACP_1_1_9_FIXTURE,
    agentId: "codex-acp",
    event: CODEX_ACP_1_1_9_FIXTURE.events.subagentStarted,
    canonicalType: "work_item.started",
    childId: "codex-child-7",
    status: "running",
  },
  {
    fixture: CURSOR_2026_07_23_FIXTURE,
    agentId: "cursor",
    event: CURSOR_2026_07_23_FIXTURE.events.taskToolStarted,
    canonicalType: "work_item.started",
    childId: "cursor:cursor-task-1",
    status: "running",
  },
  {
    fixture: OPENCODE_1_18_13_FIXTURE,
    agentId: "opencode",
    event: OPENCODE_1_18_13_FIXTURE.events.taskStarted,
    canonicalType: "work_item.started",
    childId: "opencode:opencode-task-1",
    status: "running",
  },
  {
    fixture: KILO_7_4_20_FIXTURE,
    agentId: "kilo",
    event: KILO_7_4_20_FIXTURE.events.taskStarted,
    canonicalType: "work_item.started",
    childId: "kilo:kilo-task-1",
    status: "running",
  },
] as const;

function readyStore(agentId: string, sessionId: string): SessionStore {
  const store = new SessionStore();
  store.apply({
    type: "session.ready",
    session_id: sessionId,
    acp_session_id: `acp-${sessionId}`,
    agent_id: agentId,
    cwd: "/work",
  });
  store.registerTurn(`turn-${sessionId}`, sessionId, "Exercise fixture");
  return store;
}

describe("versioned harness event conformance", () => {
  it("requires every harness fixture to account for all GUI event dimensions with evidence", () => {
    for (const fixture of harnessFixtures) {
      expect(
        Object.keys("coverage" in fixture ? fixture.coverage : {}).sort(),
        `${fixture.metadata.harness}@${fixture.metadata.harnessVersion}`,
      ).toEqual([...coverageDimensions].sort());
    }
  });

  it("projects every evidenced setup response and emitted event through canonical state into its GUI slot", () => {
    for (const fixture of harnessFixtures as readonly CoverageFixture[]) {
      for (const [dimension, coverage] of Object.entries(fixture.coverage)) {
        expect(coverage.evidence.length, `${fixture.metadata.harness} ${dimension} evidence`).toBeGreaterThan(0);
        expect(coverage.evidence[0]?.reference.trim()).not.toBe("");
        expect(coverage.evidence[0]?.claim.trim()).not.toBe("");

        if (coverage.status === "setup_response") {
          const ready = fixture.setup[coverage.setupKey!] as {
            type: "session.ready";
            session_id: string;
            acp_session_id: string;
            agent_id: string;
            cwd: string;
          };
          const canonical = toOpenMAEvent(ready, {
            occurredAt: "2026-08-05T00:00:00.000Z",
            harness: fixture.metadata.harness,
            adapter: fixture.metadata.harness,
          });
          expect(canonical?.type).toBe("session.started");
          const store = new SessionStore();
          store.apply({ ...ready, openma_event: canonical ?? undefined });
          expect(store.openmaEventsFor(ready.session_id).map((event) => event.type)).toEqual(
            expect.arrayContaining([...(coverage.expectedCanonicalTypes ?? [])]),
          );
          expect(store.get(ready.session_id)).toMatchObject({
            agent_id: ready.agent_id,
            status: "ready",
          });
          if (dimension === "modeConfig") {
            expect(store.get(ready.session_id)?.configOptions?.length).toBeGreaterThan(0);
          }
          continue;
        }

        if (coverage.status !== "emitted_event") continue;
        const sessionId = `coverage-${fixture.metadata.harness}-${dimension}`;
        const turnId = `turn-${sessionId}`;
        const store = readyStore(fixture.metadata.harness, sessionId);
        const event = fixture.events[coverage.eventKey!];
        const canonical = toOpenMAEvent({
          type: "session.event",
          session_id: sessionId,
          turn_id: turnId,
          event,
        }, {
          occurredAt: "2026-08-05T00:00:00.000Z",
          harness: fixture.metadata.harness,
          adapter: fixture.metadata.harness,
        });
        store.apply({
          type: "session.event",
          session_id: sessionId,
          turn_id: turnId,
          event,
          openma_event: canonical ?? undefined,
        });

        const canonicalTypes = store.openmaEventsFor(sessionId).map((item) => item.type);
        expect(
          canonicalTypes,
          `${fixture.metadata.harness}@${fixture.metadata.harnessVersion} ${dimension}`,
        ).toEqual(expect.arrayContaining([...(coverage.expectedCanonicalTypes ?? [])]));

        const row = store.get(sessionId);
        if (dimension === "commands") {
          expect(row?.availableCommands?.length).toBeGreaterThan(0);
        } else if (dimension === "modeConfig") {
          expect(row?.configOptions?.length || row?.currentModeId).toBeTruthy();
        } else if (dimension === "plan") {
          const reduced = reduceTurn(store.turnsFor(sessionId)[0]?.events ?? []);
          expect((reduced.plan?.length ?? 0) + (reduced.planDocument ? 1 : 0)).toBeGreaterThan(0);
        } else if (dimension === "usage") {
          expect(row?.usage).toBeDefined();
        } else if (dimension === "sessionStatus") {
          if (coverage.expectedCanonicalTypes?.includes("session.running")) {
            expect(row?.status).toBe("running");
            if (fixture.metadata.harness === "pi-acp") {
              expect(row?.providerQueueDepth).toBe(1);
            }
          } else {
            expect(row?.sessionUpdatedAt || row?.label).toBeTruthy();
          }
        } else if (dimension === "terminalBackground") {
          if (coverage.expectedCanonicalTypes?.some((type) => type.startsWith("work_item."))) {
            expect(store.workItemsFor(sessionId).length).toBeGreaterThan(0);
          } else {
            expect(store.turnsFor(sessionId)[0]?.events.length).toBeGreaterThan(0);
          }
        } else if (dimension === "nativeAgent") {
          expect(store.subagentsFor(sessionId).length).toBeGreaterThan(0);
        }
      }
    }
  });

  for (const testCase of nativeCases) {
    const label = `${testCase.fixture.metadata.harness}@${testCase.fixture.metadata.harnessVersion}`;
    it(`${label} projects native lifecycle into canonical Agents`, () => {
      const sessionId = `fixture-${testCase.agentId}`;
      const store = readyStore(testCase.agentId, sessionId);
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: `turn-${sessionId}`,
        event: testCase.event,
      });

      expect(store.openmaEventsFor(sessionId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: testCase.canonicalType,
            work_item_id: testCase.childId,
          }),
        ]),
      );
      expect(store.subagentsFor(sessionId)).toEqual([
        expect.objectContaining({
          childSessionId: testCase.childId,
          status: testCase.status,
        }),
      ]);
    });
  }

  it("pi-acp@0.0.33 projects a structured write into canonical Tool and Outputs", () => {
    const sessionId = "fixture-pi";
    const turnId = `turn-${sessionId}`;
    const event = PI_ACP_0_0_33_FIXTURE.events.writeCompleted;
    const canonical = toOpenMAEvent({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event,
    }, {
      occurredAt: "2026-08-05T00:00:00.000Z",
      harness: "pi-acp",
      adapter: "pi",
    });
    expect(canonical).toMatchObject({ type: "tool.completed" });

    const store = readyStore("pi-acp", sessionId);
    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event,
      openma_event: canonical ?? undefined,
    });
    expect(store.artifactsFor(sessionId).files).toEqual(["/work/review.pptx"]);
  });

  it("cursor@2026.07.23 preserves create-plan document and stable-id todo merges", () => {
    const sessionId = "fixture-cursor-plan";
    const turnId = `turn-${sessionId}`;
    const store = readyStore("cursor", sessionId);

    for (const event of [
      CURSOR_2026_07_23_FIXTURE.events.planCreated,
      CURSOR_2026_07_23_FIXTURE.events.todosReplaced,
      CURSOR_2026_07_23_FIXTURE.events.todosMerged,
    ]) {
      const canonical = toOpenMAEvent({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event,
      }, {
        occurredAt: "2026-08-05T00:00:00.000Z",
        harness: "cursor",
        adapter: "cursor",
      });
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event,
        openma_event: canonical ?? undefined,
      });
    }

    const rendered = reduceTurn(store.turnsFor(sessionId)[0]?.events ?? []);
    expect(rendered.planDocument).toMatchObject({
      id: "cursor-plan-1",
      title: "Audit event boundaries",
      markdown: "# Audit event boundaries\n\nInspect inputs, outputs, and replay.",
    });
    expect(rendered.plan).toEqual([
      {
        id: "todo-1",
        content: "Audit inputs",
        status: "completed",
        priority: undefined,
      },
      {
        id: "todo-2",
        content: "Wire outputs",
        status: "in_progress",
        priority: undefined,
      },
      {
        id: "todo-3",
        content: "Verify replay",
        status: "cancelled",
        priority: undefined,
      },
    ]);
  });

  it("claude-agent-acp@0.64.2 preserves Monitor identity across SDK background levels", () => {
    const sessionId = "fixture-claude-monitor";
    const turnId = `turn-${sessionId}`;
    const store = readyStore("claude-acp", sessionId);

    for (const event of [
      CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorToolCompleted,
      CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorTaskStarted,
      CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.backgroundTasksWithMonitor,
    ]) {
      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event,
      });
    }
    expect(store.workItemsFor(sessionId)).toEqual([
      expect.objectContaining({
        id: "monitor-task-9",
        kind: "monitor",
        status: "running",
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.backgroundTasksEmpty,
    });
    expect(store.workItemsFor(sessionId)).toEqual([
      expect.objectContaining({
        id: "monitor-task-9",
        kind: "monitor",
        status: "unknown",
        missing_terminal: true,
      }),
    ]);

    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorTaskCompleted,
    });
    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: turnId,
      event: CLAUDE_AGENT_ACP_0_64_2_FIXTURE.events.monitorDelivery,
    });

    expect(store.workItemsFor(sessionId)).toEqual([
      expect.objectContaining({
        id: "monitor-task-9",
        kind: "monitor",
        status: "completed",
      }),
    ]);
    expect(store.openmaEventsFor(sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "work_item.missing_terminal",
          work_item_id: "monitor-task-9",
        }),
        expect.objectContaining({
          type: "work_item.completed",
          work_item_id: "monitor-task-9",
        }),
        expect.objectContaining({
          type: "monitor.event",
        }),
      ]),
    );
    expect(
      store.openmaEventsFor(sessionId)
        .find((event) => event.type === "monitor.event"),
    ).toMatchObject({ work_item_id: "monitor-task-9" });
  });

  for (const taskCase of [
    {
      label: "opencode@1.18.13",
      agentId: "opencode",
      fixture: OPENCODE_1_18_13_FIXTURE,
      provisionalId: "opencode:opencode-task-1",
      childId: "opencode-child-1",
    },
    {
      label: "kilo@7.4.20",
      agentId: "kilo",
      fixture: KILO_7_4_20_FIXTURE,
      provisionalId: "kilo:kilo-task-1",
      childId: "kilo-child-1",
    },
  ] as const) {
    it(`${taskCase.label} reidentifies the default foreground Task before terminal`, () => {
      const sessionId = `fixture-${taskCase.agentId}-foreground-lifecycle`;
      const turnId = `turn-${sessionId}`;
      const store = readyStore(taskCase.agentId, sessionId);

      for (const event of [
        taskCase.fixture.events.taskStarted,
        taskCase.fixture.events.taskCompleted,
      ]) {
        store.apply({
          type: "session.event",
          session_id: sessionId,
          turn_id: turnId,
          event,
        });
      }

      expect(store.subagentsFor(sessionId)).toEqual([
        expect.objectContaining({
          childSessionId: taskCase.childId,
          status: "complete",
        }),
      ]);
      expect(store.openmaEventsFor(sessionId)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "work_item.reidentified",
          work_item_id: taskCase.childId,
          data: { previous_work_item_id: taskCase.provisionalId },
        }),
        expect.objectContaining({
          type: "work_item.completed",
          work_item_id: taskCase.childId,
        }),
      ]));
    });
  }

  for (const taskCase of [
    {
      label: "opencode@1.18.13",
      agentId: "opencode",
      fixture: OPENCODE_1_18_13_FIXTURE,
      childId: "opencode-child-background",
      terminalEvent: OPENCODE_1_18_13_FIXTURE.events.backgroundTaskCompletedReplay,
      terminalType: "work_item.completed",
      terminalStatus: "complete",
    },
    {
      label: "kilo@7.4.20",
      agentId: "kilo",
      fixture: KILO_7_4_20_FIXTURE,
      childId: "kilo-child-background",
      terminalEvent: KILO_7_4_20_FIXTURE.events.backgroundTaskFailedReplay,
      terminalType: "work_item.failed",
      terminalStatus: "error",
    },
  ] as const) {
    it(`${taskCase.label} marks the live background terminal missing, then accepts replay evidence`, () => {
      const sessionId = `fixture-${taskCase.agentId}-background-lifecycle`;
      const turnId = `turn-${sessionId}`;
      const store = readyStore(taskCase.agentId, sessionId);

      for (const event of [
        taskCase.fixture.events.backgroundTaskStarted,
        taskCase.fixture.events.backgroundTaskRunning,
      ]) {
        store.apply({
          type: "session.event",
          session_id: sessionId,
          turn_id: turnId,
          event,
        });
      }
      store.apply({
        type: "session.complete",
        session_id: sessionId,
        turn_id: turnId,
        stop_reason: "end_turn",
      });

      expect(store.subagentsFor(sessionId)).toEqual([
        expect.objectContaining({
          childSessionId: taskCase.childId,
          status: "unknown",
        }),
      ]);
      expect(store.openmaEventsFor(sessionId)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "work_item.missing_terminal",
          work_item_id: taskCase.childId,
        }),
      ]));

      store.apply({
        type: "session.event",
        session_id: sessionId,
        turn_id: "",
        event: taskCase.terminalEvent,
      });

      expect(store.subagentsFor(sessionId)).toEqual([
        expect.objectContaining({
          childSessionId: taskCase.childId,
          status: taskCase.terminalStatus,
        }),
      ]);
      expect(store.openmaEventsFor(sessionId)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: taskCase.terminalType,
          work_item_id: taskCase.childId,
        }),
      ]));
    });
  }

  it("kimi@1.49.0 projects its terminal notification into canonical Background", () => {
    const sessionId = "fixture-kimi";
    const store = readyStore("kimi-acp", sessionId);
    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: `turn-${sessionId}`,
      event: KIMI_1_49_0_FIXTURE.events.backgroundCompleted,
    });

    expect(store.openmaEventsFor(sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "work_item.completed",
          work_item_id: "b1234567",
        }),
      ]),
    );
    expect(store.workItemsFor(sessionId)).toEqual([
      expect.objectContaining({
        id: "b1234567",
        status: "completed",
        missing_start: true,
      }),
    ]);
  });

  it("kimi@1.49.0 keeps an idle timeout session-scoped and terminal-only", () => {
    const sessionId = "fixture-kimi-idle-timeout";
    const store = readyStore("kimi-acp", sessionId);
    store.apply({
      type: "session.event",
      session_id: sessionId,
      turn_id: "",
      event: KIMI_1_49_0_FIXTURE.events.backgroundTimedOut,
    });

    const failed = store.openmaEventsFor(sessionId).find(
      (event) => event.type === "work_item.failed",
    );
    expect(failed).toMatchObject({
      work_item_id: "b7654321",
      data: {
        kind: "other",
        title: "wait for service",
        reason: "timed_out",
        error: "Command timed out after 30s",
      },
    });
    expect(failed).not.toHaveProperty("turn_id");
    expect(store.workItemsFor(sessionId)).toEqual([
      expect.objectContaining({
        id: "b7654321",
        status: "failed",
        missing_start: true,
        reason: "timed_out",
      }),
    ]);
  });
});
