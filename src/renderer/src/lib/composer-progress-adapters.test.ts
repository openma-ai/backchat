import { describe, expect, it, vi } from "vitest";

import { composerProgressCallbacksForSessionCapabilities } from "./composer-progress-adapters";

describe("composerProgressCallbacksForSessionCapabilities", () => {
  it("uses an advertised Goal command for pause regardless of harness", async () => {
    const calls: string[] = [];
    const cancelTurn = vi.fn(async () => {
      calls.push("cancel");
    });
    const runCommand = vi.fn(async () => {
      calls.push("command");
    });

    const callbacks = composerProgressCallbacksForSessionCapabilities(
      {
        sessionId: "session-1",
        activeTurnId: "turn-1",
        progressKind: "goal",
        status: "active",
        availableCommands: [{ name: "goal" }],
      },
      { cancelTurn, runCommand },
    );

    await callbacks.pause?.();

    expect(calls).toEqual(["cancel", "command"]);
    expect(cancelTurn).toHaveBeenCalledWith({
      session_id: "session-1",
      turn_id: "turn-1",
    });
    expect(runCommand).toHaveBeenCalledWith({
      session_id: "session-1",
      command: "goal",
      args: "pause",
    });
  });

  it("uses an advertised Goal command for resume regardless of harness", async () => {
    const cancelTurn = vi.fn(async () => undefined);
    const runCommand = vi.fn(async () => undefined);
    const callbacks = composerProgressCallbacksForSessionCapabilities(
      {
        sessionId: "session-1",
        progressKind: "goal",
        status: "paused",
        availableCommands: [{ name: "goal" }],
      },
      { cancelTurn, runCommand },
    );

    await callbacks.resume?.();

    expect(cancelTurn).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledWith({
      session_id: "session-1",
      command: "goal",
      args: "resume",
    });
  });

  it("does not invent progress controls when the harness omits the Goal command", () => {
    const callbacks = composerProgressCallbacksForSessionCapabilities(
      {
        sessionId: "session-1",
        progressKind: "goal",
        status: "active",
      },
      {
        cancelTurn: vi.fn(),
        runCommand: vi.fn(),
      },
    );

    expect(callbacks).toEqual({});
  });
});

describe("editing a goal", () => {
  const context = {
    sessionId: "sess-1",
    progressKind: "goal" as const,
    status: "active",
    objective: "使世界和平",
    availableCommands: [{ name: "goal" }],
  };

  it("hands the objective back so a word can be changed", async () => {
    const editGoal = vi.fn();
    const callbacks = composerProgressCallbacksForSessionCapabilities(context, {
      cancelTurn: vi.fn(),
      runCommand: vi.fn(),
      editGoal,
    });

    await callbacks.edit?.();

    expect(editGoal).toHaveBeenCalledWith({
      session_id: "sess-1",
      objective: "使世界和平",
    });
  });

  it("offers no edit when the host cannot carry it", () => {
    // A permanently disabled control is a lie; without a transport there is
    // simply no affordance.
    expect(
      composerProgressCallbacksForSessionCapabilities(context, {
        cancelTurn: vi.fn(),
        runCommand: vi.fn(),
      }).edit,
    ).toBeUndefined();
  });
});
