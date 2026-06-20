import { describe, expect, it } from "vitest";
import {
  createPetRuntime,
  createQuietProactivityPolicy,
  defaultPetHooks,
  normalizeBackchatSessionEvent,
  type PetAction,
  type PetSignal,
} from "./index.js";

describe("normalizeBackchatSessionEvent", () => {
  it("turns Backchat ACP tool updates into stable pet signals", () => {
    const signals = normalizeBackchatSessionEvent({
      type: "session.event",
      session_id: "sess-1",
      turn_id: "turn-1",
      event: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Running tests",
        kind: "execute",
        status: "in_progress",
      },
    });

    expect(signals).toEqual([
      {
        id: "backchat:sess-1:turn-1:tool_call:tool-1",
        source: "backchat.acp",
        name: "tool_call",
        sessionId: "sess-1",
        turnId: "turn-1",
        labels: {
          toolCallId: "tool-1",
          toolKind: "execute",
          toolStatus: "in_progress",
          title: "Running tests",
        },
        payload: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Running tests",
          kind: "execute",
          status: "in_progress",
        },
      },
    ]);
  });

  it("turns Backchat lifecycle events into stable pet signals", () => {
    expect(
      normalizeBackchatSessionEvent({
        type: "session.error",
        session_id: "sess-1",
        turn_id: "turn-1",
        message: "permission denied",
      }),
    ).toEqual([
      {
        id: "backchat:sess-1:turn-1:session.error",
        source: "backchat.session",
        name: "session.error",
        sessionId: "sess-1",
        turnId: "turn-1",
        labels: { message: "permission denied" },
        payload: {
          type: "session.error",
          session_id: "sess-1",
          turn_id: "turn-1",
          message: "permission denied",
        },
      },
    ]);
  });
});

describe("createPetRuntime", () => {
  it("allows classic atlas motions in hooks", () => {
    const runtime = createPetRuntime({
      hooks: [
        {
          id: "classic-wave",
          when: (signal) => signal.name === "pet.clicked",
          run: (): PetAction => ({
            type: "motion",
            motion: "waving",
            intensity: "low",
            priority: "normal",
          }),
        },
      ],
    });

    expect(runtime.dispatch({ id: "click-1", source: "pet-app", name: "pet.clicked" }))
      .toEqual<PetAction[]>([
        {
          type: "motion",
          motion: "waving",
          intensity: "low",
          priority: "normal",
        },
      ]);
  });

  it("maps default ACP signals into richer pet motions", () => {
    const runtime = createPetRuntime({ hooks: defaultPetHooks() });

    const actions = runtime.dispatch({
      id: "sig-1",
      source: "backchat.acp",
      name: "tool_call",
      sessionId: "sess-1",
      turnId: "turn-1",
      labels: {
        title: "Editing package.json",
        toolKind: "edit",
        toolStatus: "in_progress",
      },
    });

    expect(actions).toEqual<PetAction[]>([
      {
        type: "motion",
        motion: "tool-edit",
        intensity: "medium",
        priority: "normal",
        reason: "tool_call:edit",
        sessionId: "sess-1",
        turnId: "turn-1",
        label: "Editing package.json",
      },
    ]);
  });

  it("accepts general hooks for non-ACP agent harnesses", () => {
    const runtime = createPetRuntime({
      hooks: [
        {
          id: "cc-permission",
          priority: 50,
          when: (signal) =>
            signal.source === "claude-code" &&
            signal.name === "permission_request",
          run: (signal) => [
            {
              type: "motion",
              motion: "ask",
              intensity: "high",
              priority: "urgent",
              reason: "permission_request",
              sessionId: signal.sessionId,
              turnId: signal.turnId,
              label: signal.labels?.["title"],
            },
            {
              type: "emit",
              target: "agent-harness",
              event: "pet:attention",
              priority: "urgent",
              payload: { sessionId: signal.sessionId },
            },
          ],
        },
      ],
    });

    const actions = runtime.dispatch({
      id: "sig-cc-1",
      source: "claude-code",
      name: "permission_request",
      sessionId: "cc-session",
      labels: { title: "Approve file edit" },
    });

    expect(actions).toEqual<PetAction[]>([
      {
        type: "motion",
        motion: "ask",
        intensity: "high",
        priority: "urgent",
        reason: "permission_request",
        sessionId: "cc-session",
        turnId: undefined,
        label: "Approve file edit",
      },
      {
        type: "emit",
        target: "agent-harness",
        event: "pet:attention",
        priority: "urgent",
        payload: { sessionId: "cc-session" },
      },
    ]);
  });

  it("throttles lightweight proactive actions without dropping reactive actions", () => {
    let now = 1_000;
    const runtime = createPetRuntime({
      now: () => now,
      proactive: createQuietProactivityPolicy({
        minIntervalMs: 10_000,
        windowMs: 60_000,
        maxPerWindow: 2,
      }),
      hooks: [
        {
          id: "long-idle-nudge",
          when: (signal) => signal.name === "workspace.idle",
          run: (): PetAction => ({
            type: "speech",
            text: "Want me to keep an eye on the failing test?",
            tone: "helpful",
            priority: "low",
            proactive: true,
            ttlMs: 6_000,
          }),
        },
        {
          id: "session-error",
          when: (signal: PetSignal) => signal.name === "session.error",
          run: (): PetAction => ({
            type: "motion",
            motion: "warn",
            intensity: "high",
            priority: "urgent",
            reason: "session.error",
          }),
        },
      ],
    });

    expect(runtime.dispatch({ id: "idle-1", source: "scheduler", name: "workspace.idle" }))
      .toHaveLength(1);

    now += 1_000;
    expect(runtime.dispatch({ id: "idle-2", source: "scheduler", name: "workspace.idle" }))
      .toHaveLength(0);

    expect(runtime.dispatch({ id: "err-1", source: "backchat.session", name: "session.error" }))
      .toEqual<PetAction[]>([
        {
          type: "motion",
          motion: "warn",
          intensity: "high",
          priority: "urgent",
          reason: "session.error",
        },
      ]);

    now += 10_000;
    expect(runtime.dispatch({ id: "idle-3", source: "scheduler", name: "workspace.idle" }))
      .toHaveLength(1);

    now += 10_000;
    expect(runtime.dispatch({ id: "idle-4", source: "scheduler", name: "workspace.idle" }))
      .toHaveLength(0);
  });
});
