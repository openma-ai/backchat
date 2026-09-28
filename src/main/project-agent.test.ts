import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { expect, it } from "vitest";
import { createOpenMAEvent, type OpenMAEvent } from "@openmatter/agent";
import { ProjectAgentBridge } from "./project-agent.js";
import { ProjectWorkspaceManager } from "./project-workspace.js";

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
      expect(prompts[0]).toContain(raw.memoryDirectory);
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
