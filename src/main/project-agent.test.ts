import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { expect, it } from "vitest";
import {
  createOpenMAEvent,
  type AgentDriver,
  type OpenMAEvent,
} from "@openmatter/agent";
import type {
  ContextItem,
  ContextProjection,
  JsonValue,
} from "@openmatter/core";
import { ProjectAgentBridge } from "./project-agent.js";
import { ProjectWorkspaceManager } from "./project-workspace.js";
import type { SessionPromptParams } from "../shared/session-events.js";

it.each(["coordinator", "worker"] as const)(
  "gives a %s its own readable memory path on create and resume",
  async (role) => {
    const root = await mkdtemp(join(tmpdir(), "project-agent-memory-"));
    const db = new DatabaseSync(":memory:");
    const starts: import("../shared/session-events.js").SessionStartParams[] =
      [];
    const prompts: string[] = [];
    const startupBindings: unknown[] = [];
    const bridge = new ProjectAgentBridge(
      db,
      {
        start: async (p) => {
          startupBindings.push(bridge.bindings.get(p.session_id));
          starts.push(p);
          return {
            status: "ready",
            session_id: p.session_id,
            agent_id: p.agent_id,
            acp_session_id: "remote",
            cwd: p.cwd!,
          };
        },
        prompt: async (p) => {
          prompts.push(p.text);
          bridge.observe(
            createOpenMAEvent({
              event_id: "done",
              session_id: p.session_id,
              turn_id: p.turn_id,
              seq: 1,
              type: "turn.completed",
              source: { kind: "harness", harness: "test" },
              occurred_at: new Date().toISOString(),
              data: {},
            }),
          );
        },
        cancel: () => {},
        dispose: async () => {},
        findSession: () => null,
      },
      new ProjectWorkspaceManager(db, root),
    );
    const driver = bridge.driver(
      "test",
      {
        id: "p",
        name: "P",
        primary_folder: "",
        source_folders: [],
        created_at: 1,
        updated_at: 1,
      },
      role,
    );
    try {
      const handle = await Effect.runPromise(
        driver.createSession({
          sessionId: "s",
          bindingKey: "b",
          workThreadId: "thread",
          generation: 1,
          idempotencyKey: "s",
        }),
      );
      const raw = handle.raw as { memoryDirectory: string };
      expect(raw.memoryDirectory).toEqual(expect.any(String));
      expect(await readdir(raw.memoryDirectory)).toEqual([]);
      const resumed = await Effect.runPromise(driver.resumeSession!(handle));
      expect(startupBindings).toEqual([
        { projectId: "p", role, workThreadId: "thread" },
        { projectId: "p", role, workThreadId: "thread" },
      ]);
      expect((resumed.raw as typeof raw).memoryDirectory).toBe(
        raw.memoryDirectory,
      );
      expect(starts.map((p) => p.additional_directories)).toEqual([
        [raw.memoryDirectory],
        [raw.memoryDirectory],
      ]);
      await Effect.runPromise(
        Stream.runDrain(
          driver.turn({
            session: resumed,
            sessionId: "s",
            turnId: "t",
            afterSequence: 0,
            context: {
              schemaVersion: "0.1",
              id: "c",
              scopeId: "p",
              workThreadId: "thread",
              triggerEventId: "e",
              digest: "d",
              createdAt: new Date().toISOString(),
              grants: [],
              items: [],
            },
            allow: [],
          }),
        ),
      );
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).not.toContain(raw.memoryDirectory);
      expect(bridge.bindings.get("s")).toMatchObject({ projectId: "p", role, workThreadId: "thread" });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each(["failed", "completed"] as const)(
  "waits for the prompt boundary after a session error (%s)",
  async (outcome) => {
    const db = new DatabaseSync(":memory:");
    let settle!: () => void;
    let began!: () => void;
    const pendingPrompt = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const events: OpenMAEvent[] = [];
    const event = (
      type: "session.error" | "turn.completed",
      data: Record<string, unknown>,
    ) =>
      createOpenMAEvent({
        event_id: type,
        session_id: "auth-session",
        turn_id: "auth-turn",
        seq: 1,
        type,
        source: { kind: "harness", harness: "test" },
        occurred_at: new Date().toISOString(),
        data,
      });
    const bridge = new ProjectAgentBridge(
      db,
      {
        start: async (p) => ({
          status: "ready",
          session_id: p.session_id,
          agent_id: p.agent_id,
          acp_session_id: "remote",
          cwd: "/tmp",
        }),
        prompt: async () => {
          bridge.observe(
            event("session.error", {
              message: "Sign in again",
              code: "auth_required",
            }),
          );
          began();
          await pendingPrompt;
          if (outcome === "completed")
            bridge.observe(
              event("turn.completed", { stop_reason: "end_turn" }),
            );
        },
        cancel: () => {},
        dispose: async () => {},
        findSession: () => null,
      },
      {
        prepare: async () => ({
          id: "workspace",
          cwd: "/tmp",
          additionalDirectories: [],
          branch: null,
          worktrees: [],
        }),
      },
    );
    const driver = bridge.driver(
      "test",
      {
        id: "p",
        name: "P",
        primary_folder: "/tmp",
        source_folders: ["/tmp"],
        created_at: 1,
        updated_at: 1,
      },
      "coordinator",
    );
    const collecting = Effect.runPromise(
      Stream.runForEach(
        driver.turn({
          session: { id: "auth-session" },
          sessionId: "auth-session",
          turnId: "auth-turn",
          afterSequence: 0,
          context: {
            schemaVersion: "0.1",
            id: "c",
            scopeId: "p",
            workThreadId: "w",
            triggerEventId: "e",
            digest: "d",
            createdAt: new Date().toISOString(),
            grants: [],
            items: [],
          },
          allow: [],
        }),
        (item) =>
          Effect.sync(() => {
            events.push(item);
          }),
      ),
    );
    try {
      await started;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(events.map((item) => item.type)).toEqual(["session.error"]);
      settle();
      await collecting;
      expect(events.map((item) => item.type)).toEqual([
        "session.error",
        `turn.${outcome}`,
      ]);
      if (outcome === "failed")
        expect(events.at(-1)?.data).toMatchObject({
          message: "Sign in again",
          code: "auth_required",
        });
    } finally {
      settle();
      await collecting;
      db.close();
    }
  },
);
it("never redispatches a turn after its durable dispatch marker, including zero-event crashes", async () => {
  const db = new DatabaseSync(":memory:");
  let prompts = 0;
  const bridge = new ProjectAgentBridge(
    db,
    {
      start: async (p) => ({
        status: "ready",
        session_id: p.session_id,
        agent_id: p.agent_id,
        acp_session_id: "remote",
        cwd: "/tmp",
      }),
      prompt: async (p) => {
        prompts++;
        bridge.observe(
          createOpenMAEvent({
            event_id: "finished",
            session_id: p.session_id,
            turn_id: p.turn_id,
            seq: 90,
            type: "turn.completed",
            source: { kind: "harness", harness: "test" },
            occurred_at: new Date().toISOString(),
            data: {},
          }),
        );
      },
      cancel: () => {},
      dispose: async () => {},
      findSession: () => null,
    },
    {
      prepare: async () => ({
        id: "test-workspace",
        cwd: "/tmp",
        additionalDirectories: [],
        branch: null,
        worktrees: [],
      }),
    },
  );
  const driver = bridge.driver(
    "test",
    {
      id: "p",
      name: "P",
      primary_folder: "/tmp",
      source_folders: ["/tmp"],
      created_at: 1,
      updated_at: 1,
    },
    "coordinator",
  );
  const handle = await Effect.runPromise(
    driver.createSession({
      sessionId: "s",
      bindingKey: "b",
      generation: 1,
      idempotencyKey: "s",
    }),
  );
  const input = {
    session: handle,
    sessionId: "s",
    turnId: "t",
    afterSequence: 0,
    context: {
      schemaVersion: "0.1",
      id: "c",
      scopeId: "p",
      workThreadId: "w",
      triggerEventId: "e",
      digest: "d",
      createdAt: new Date().toISOString(),
      grants: [],
      items: [],
    },
    allow: [],
  };
  const first = Array.from(
    await Effect.runPromise(Stream.runCollect(driver.turn(input))),
  );
  expect(first.at(-1)).toMatchObject({ type: "turn.completed", seq: 1 });
  const replay = Array.from(
    await Effect.runPromise(Stream.runCollect(driver.turn(input))),
  );
  expect(replay.at(-1)).toMatchObject({ type: "turn.interrupted", seq: 1 });
  expect(prompts).toBe(1);
  db.close();
});

it("keeps a WorkThread workspace when its session generation changes", async () => {
  const db = new DatabaseSync(":memory:");
  const starts: import("../shared/session-events.js").SessionStartParams[] = [];
  const threads: string[] = [];
  const host = {
    start: async (
      p: import("../shared/session-events.js").SessionStartParams,
    ) => {
      starts.push(p);
      return {
        status: "ready" as const,
        session_id: p.session_id,
        agent_id: p.agent_id,
        acp_session_id: p.session_id,
        cwd: p.cwd!,
      };
    },
    prompt: async () => {},
    cancel: () => {},
    dispose: async () => {},
    findSession: () => null,
  };
  const workspaces = {
    prepare: async (_p: unknown, thread: string) => {
      threads.push(thread);
      return {
        id: "workspace",
        cwd: "/isolated/thread",
        additionalDirectories: [],
        branch: "thread-branch",
        worktrees: [],
      };
    },
  };
  const bridge = new ProjectAgentBridge(db, host, workspaces);
  const driver = bridge.driver(
    "test",
    {
      id: "p",
      name: "P",
      primary_folder: "/source",
      source_folders: ["/source"],
      created_at: 1,
      updated_at: 1,
    },
    "worker",
  );
  try {
    for (const generation of [1, 2])
      await Effect.runPromise(
        driver.createSession({
          sessionId: `s${generation}`,
          bindingKey: "binding",
          generation,
          idempotencyKey: `s${generation}`,
          scopeId: "p",
          workThreadId: "worker:stable",
        }),
      );
    expect(threads).toEqual(["worker:stable", "worker:stable"]);
    expect(starts.map((s) => s.cwd)).toEqual([
      "/isolated/thread",
      "/isolated/thread",
    ]);
  } finally {
    db.close();
  }
});

it("sends the full coordinator preamble on a fresh ACP session's first prompt", async () => {
  const { db, driver, prompts } = projectAgentPromptRig();
  try {
    const session = await createProjectAgentSession(driver);
    await runProjectAgentTurn(driver, session, "fresh-first", [
      projectEvent("event:message:client-1", "project.message", {
        text: "First user request",
      }),
      contextItem("instructions", "project-instructions", {
        instructions: "Stable project instructions",
      }),
    ]);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.text).toContain(
      "You are the coordinator for project Project Alpha.",
    );
    expect(prompts[0]?.text).toContain("Stable project instructions");
    expect(prompts[0]?.display_text).toBe("First user request");
  } finally {
    db.close();
  }
});

it("sends only the next event context after the first prompt in an ACP session", async () => {
  const { db, driver, prompts } = projectAgentPromptRig();
  const secondEvent = projectEvent("worker:completed", "project.worker.completed", {
    result: "Second event payload",
  });
  try {
    const session = await createProjectAgentSession(driver);
    await runProjectAgentTurn(driver, session, "same-session-first", [
      projectEvent("event:message:client-1", "project.message", {
        text: "First user request",
      }),
      contextItem("instructions", "project-instructions", {
        instructions: "Stable project instructions",
      }),
    ]);
    await runProjectAgentTurn(driver, session, "same-session-second", [
      secondEvent,
      contextItem("instructions", "project-instructions", {
        instructions: "Stable project instructions",
      }),
      contextItem("workspace", "project-workspaces", {
        cwd: "/stable/workspace",
      }),
    ]);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.text).toBe(
      [
        "New project work event follows.",
        JSON.stringify({ context: [secondEvent] }),
      ].join("\n\n"),
    );
    expect(prompts[1]?.text).not.toContain("You are the");
    expect(prompts[1]?.display_text).toBe(
      "Project event: project.worker.completed",
    );
  } finally {
    db.close();
  }
});

it("omits the coordinator preamble when the ACP session is resumed", async () => {
  const { db, driver, prompts } = projectAgentPromptRig();
  try {
    const created = await createProjectAgentSession(driver);
    const resumed = await Effect.runPromise(driver.resumeSession!(created));
    const event = projectEvent("worker:resumed", "project.worker.resumed", {
      result: "Resumed event payload",
    });
    await runProjectAgentTurn(driver, resumed, "resumed-first", [event]);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.text).toBe(
      [
        "New project work event follows.",
        JSON.stringify({ context: [event] }),
      ].join("\n\n"),
    );
    expect(prompts[0]?.text).not.toContain("You are the");
  } finally {
    db.close();
  }
});

it("sets an explicit display label for project prompts without user text", async () => {
  const { db, driver, prompts } = projectAgentPromptRig();
  try {
    const session = await createProjectAgentSession(driver);
    await runProjectAgentTurn(driver, session, "no-user-text", [
      projectEvent("goal:continued", "project.goal.continue", {
        internalPayload: "not display text",
      }),
    ]);

    expect(prompts[0]?.display_text).toBe(
      "Project event: project.goal.continue",
    );
    expect(prompts[0]?.display_text).not.toContain("not display text");
  } finally {
    db.close();
  }
});

it("resends the full preamble when the first prompt in an ACP session fails", async () => {
  const { db, driver, prompts } = projectAgentPromptRig({ failFirstPrompt: true });
  try {
    const session = await createProjectAgentSession(driver);
    await runProjectAgentTurn(driver, session, "failed-first", [
      projectEvent("event:message:client-1", "project.message", {
        text: "First user request",
      }),
    ]);
    await runProjectAgentTurn(driver, session, "retry", [
      projectEvent("event:message:client-2", "project.message", {
        text: "Second user request",
      }),
    ]);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.text).toContain(
      "You are the coordinator for project Project Alpha.",
    );
  } finally {
    db.close();
  }
});

function projectAgentPromptRig(options: { failFirstPrompt?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  const prompts: SessionPromptParams[] = [];
  let bridge!: ProjectAgentBridge;
  bridge = new ProjectAgentBridge(
    db,
    {
      start: async (params) => ({
        status: "ready",
        session_id: params.session_id,
        agent_id: params.agent_id,
        acp_session_id: params.resume?.acp_session_id ?? "remote-session",
        cwd: params.cwd!,
      }),
      prompt: async (params) => {
        prompts.push(params);
        if (options.failFirstPrompt && prompts.length === 1)
          throw new Error("agent rejected the prompt");
        bridge.observe(
          createOpenMAEvent({
            event_id: `done-${params.turn_id}`,
            session_id: params.session_id,
            turn_id: params.turn_id,
            seq: 1,
            type: "turn.completed",
            source: { kind: "harness", harness: "test" },
            occurred_at: new Date().toISOString(),
            data: {},
          }),
        );
      },
      cancel: () => {},
      dispose: async () => {},
      findSession: () => null,
    },
    {
      prepare: async (_project, workThreadId) => ({
        id: "workspace",
        cwd: `/workspace/${workThreadId}`,
        additionalDirectories: [],
        branch: "thread",
        worktrees: [],
      }),
    },
  );

  return {
    db,
    driver: bridge.driver(
      "test",
      {
        id: "project",
        name: "Project Alpha",
        primary_folder: "/source",
        source_folders: ["/source"],
        created_at: 1,
        updated_at: 1,
      },
      "coordinator",
    ),
    prompts,
  };
}

async function createProjectAgentSession(driver: AgentDriver) {
  return Effect.runPromise(
    driver.createSession({
      sessionId: "project-session",
      bindingKey: "project-thread",
      workThreadId: "project-thread",
      generation: 1,
      idempotencyKey: "project-session",
    }),
  );
}

async function runProjectAgentTurn(
  driver: AgentDriver,
  session: { readonly id: string; readonly raw?: JsonValue },
  turnId: string,
  items: ContextItem[],
) {
  await Effect.runPromise(
    Stream.runDrain(
      driver.turn({
        session,
        sessionId: session.id,
        turnId,
        afterSequence: 0,
        context: {
          schemaVersion: "0.1",
          id: `context-${turnId}`,
          scopeId: "project",
          workThreadId: "project-thread",
          triggerEventId: items.find((item) => item.kind === "event")?.id ?? turnId,
          digest: "digest",
          createdAt: new Date().toISOString(),
          grants: [],
          items,
        } satisfies ContextProjection,
        allow: [],
      }),
    ),
  );
}

function contextItem(
  id: string,
  kind: string,
  value: ContextItem["value"],
): ContextItem {
  return { id, kind, value, provenance: [] };
}

function projectEvent(
  id: string,
  type: string,
  payload: ContextItem["value"],
): ContextItem {
  return contextItem(`context-${id}`, "event", { id, type, payload });
}
