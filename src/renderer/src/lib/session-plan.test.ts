import { describe, expect, test } from "vitest";

import {
  latestPlanDocumentForEvents,
  latestPlanForTurns,
  latestTaskListForTurns,
} from "./session-plan";

describe("latestPlanForTurns", () => {
  test("uses the newest non-empty plan update across turns", () => {
    expect(
      latestPlanForTurns([
        {
          events: [
            {
              payload: {
                sessionUpdate: "plan",
                entries: [{ content: "Old step", status: "completed" }],
              },
            },
          ],
        } as never,
        {
          events: [
            {
              payload: {
                sessionUpdate: "plan",
                entries: [
                  { content: "New step", status: "in_progress" },
                  { content: "Next step", status: "pending" },
                ],
              },
            },
          ],
        } as never,
      ]),
    ).toEqual([
      { content: "New step", status: "in_progress", priority: undefined },
      { content: "Next step", status: "pending", priority: undefined },
    ]);
  });

  test("clears an older plan when the newest full snapshot is empty", () => {
    expect(
      latestPlanForTurns([
        {
          events: [
            {
              payload: {
                sessionUpdate: "plan",
                entries: [{ content: "Old step", status: "in_progress" }],
              },
            },
          ],
        } as never,
        {
          events: [
            {
              payload: {
                sessionUpdate: "plan",
                entries: [],
              },
            },
          ],
        } as never,
      ]),
    ).toEqual([]);
  });

  test("removes an item plan only when plan_removed names the same planId", () => {
    expect(
      latestPlanForTurns([
        {
          events: [
            {
              payload: {
                sessionUpdate: "plan_update",
                plan: {
                  type: "items",
                  planId: "plan-items-1",
                  entries: [{ content: "Old step", status: "in_progress" }],
                },
              },
            },
            {
              payload: {
                sessionUpdate: "plan_removed",
                planId: "plan-items-1",
              },
            },
          ],
        } as never,
      ]),
    ).toEqual([]);
  });
});

describe("latestTaskListForTurns", () => {
  test("applies canonical merge deltas before projecting the shared task list", () => {
    expect(
      latestTaskListForTurns("cursor", [
        {
          events: [
            {
              payload: {
                schema_version: "oma.event.v1",
                type: "plan.updated",
                data: {
                  representation: "items",
                  plan_id: "cursor-todos",
                  update_mode: "replace",
                  entries: [
                    { id: "todo-1", content: "Audit inputs", status: "in_progress" },
                    { id: "todo-2", content: "Wire outputs", status: "in_progress" },
                  ],
                },
              },
            },
            {
              payload: {
                schema_version: "oma.event.v1",
                type: "plan.updated",
                data: {
                  representation: "items",
                  plan_id: "cursor-todos",
                  update_mode: "merge",
                  entries: [
                    { id: "todo-1", content: "Audit inputs", status: "completed" },
                    { id: "todo-3", content: "Verify replay", status: "cancelled" },
                  ],
                },
              },
            },
          ],
        } as never,
      ]),
    ).toEqual([
      { content: "Audit inputs", status: "completed", priority: undefined },
      { content: "Wire outputs", status: "in_progress", priority: undefined },
      { content: "Verify replay", status: "cancelled", priority: undefined },
    ]);
  });

  test("uses the standard ACP plan snapshot for Claude Agent SDK tasks", () => {
    expect(
      latestTaskListForTurns("claude-acp", [
        {
          events: [
            {
              payload: {
                sessionUpdate: "plan",
                entries: [
                  { content: "Inspect SDK events", status: "completed" },
                  { content: "Render tasks", status: "in_progress" },
                ],
              },
            },
          ],
        } as never,
      ]),
    ).toEqual([
      { content: "Inspect SDK events", status: "completed", priority: undefined },
      { content: "Render tasks", status: "in_progress", priority: undefined },
    ]);
  });

  test.each(["opencode", "kilo"])(
    "does not make the shared task-list GUI parse %s todowrite metadata",
    (agentId) => {
      expect(
        latestTaskListForTurns(agentId, [
          {
            events: [
              {
                payload: {
                  sessionUpdate: "tool_call",
                  toolCallId: "todo-1",
                  title: "2 todos",
                  rawInput: {
                    todos: [
                      {
                        content: "Inspect adapter",
                        status: "completed",
                        priority: "high",
                      },
                      {
                        content: "Wire task list",
                        status: "cancelled",
                        priority: "medium",
                      },
                    ],
                  },
                  _meta: { toolName: "todowrite" },
                },
              },
            ],
          } as never,
        ]),
      ).toEqual([]);
    },
  );

  test("lets a later standard ACP empty plan clear an adapted todo snapshot", () => {
    expect(
      latestTaskListForTurns("opencode", [
        {
          events: [
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "todo-1",
                rawInput: {
                  todos: [{ content: "Old task", status: "in_progress" }],
                },
                _meta: { toolName: "todowrite" },
              },
            },
            {
              payload: {
                sessionUpdate: "plan",
                entries: [],
              },
            },
          ],
        } as never,
      ]),
    ).toEqual([]);
  });

  test("does not invent a task list for pi-acp, which has no built-in todo semantics", () => {
    expect(
      latestTaskListForTurns("pi-acp", [
        {
          events: [
            {
              payload: {
                sessionUpdate: "tool_call",
                toolCallId: "tool-1",
                title: "TODO.md",
                rawInput: { path: "TODO.md" },
              },
            },
          ],
        } as never,
      ]),
    ).toEqual([]);
  });
});

describe("latestPlanDocumentForEvents", () => {
  test("projects a canonical plan document that also carries task entries", () => {
    expect(
      latestPlanDocumentForEvents([
        {
          payload: {
            schema_version: "oma.event.v1",
            type: "plan.updated",
            data: {
              representation: "markdown",
              plan_id: "cursor-plan-1",
              document: {
                id: "cursor-plan-1",
                title: "Release",
                markdown: "# Release\n\nShip safely",
              },
              entries: [
                { id: "todo-1", content: "Run tests", status: "pending" },
              ],
            },
          },
        },
      ]),
    ).toEqual({
      id: "cursor-plan-1",
      title: "Release",
      markdown: "# Release\n\nShip safely",
    });
  });

  test("projects the current ACP Markdown plan shape into the existing Plan slot", () => {
    expect(
      latestPlanDocumentForEvents([
        {
          payload: {
            sessionUpdate: "plan_update",
            plan: {
              type: "markdown",
              planId: "plan-markdown-1",
              content: "# Ship\n\nImplement it",
            },
          },
        },
      ]),
    ).toEqual({
      id: "plan-markdown-1",
      markdown: "# Ship\n\nImplement it",
    });
  });

  test("projects a current ACP file plan into the existing Plan slot without losing its URI", () => {
    expect(
      latestPlanDocumentForEvents([
        {
          payload: {
            sessionUpdate: "plan_update",
            plan: {
              type: "file",
              planId: "plan-file-1",
              uri: "file:///repo/PLAN.md",
            },
          },
        },
      ]),
    ).toEqual({
      id: "plan-file-1",
      uri: "file:///repo/PLAN.md",
      title: "Plan file",
      markdown: "[Open plan file](file:///repo/PLAN.md)",
    });
  });

  test("does not let removal of one planId hide another current plan", () => {
    expect(
      latestPlanDocumentForEvents([
        {
          payload: {
            sessionUpdate: "plan_update",
            plan: {
              type: "markdown",
              planId: "plan-markdown-2",
              content: "# Current plan",
            },
          },
        },
        {
          payload: {
            sessionUpdate: "plan_removed",
            planId: "plan-markdown-1",
          },
        },
      ]),
    ).toEqual({
      id: "plan-markdown-2",
      markdown: "# Current plan",
    });
  });

  test("adapts Claude ExitPlanMode into the shared Markdown plan GUI", () => {
    expect(
      latestPlanDocumentForEvents(
        [
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "exit-plan-1",
              rawInput: {
                plan: "# Ship the feature\n\n1. Inspect\n2. Implement",
              },
              _meta: {
                claudeCode: { toolName: "ExitPlanMode" },
              },
            },
          },
        ],
        "claude-acp",
      ),
    ).toEqual({
      id: "exit-plan-1",
      sourceToolCallId: "exit-plan-1",
      title: "Ship the feature",
      markdown: "# Ship the feature\n\n1. Inspect\n2. Implement",
    });
  });

  test("does not reinterpret another ACP agent's tool input as a plan document", () => {
    expect(
      latestPlanDocumentForEvents(
        [
          {
            payload: {
              sessionUpdate: "tool_call",
              toolCallId: "tool-1",
              toolName: "ExitPlanMode",
              rawInput: { plan: "# Not a declared Pi semantic" },
            },
          },
        ],
        "pi-acp",
      ),
    ).toBeUndefined();
  });
});
