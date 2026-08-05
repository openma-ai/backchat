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
