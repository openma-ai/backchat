import type {
  ComposerProgressCallbacks,
  ComposerProgressPresentation,
} from "./composer-progress";

interface ProgressCallbackContext {
  sessionId: string;
  activeTurnId?: string;
  progressKind: ComposerProgressPresentation["kind"];
  status?: string;
  /** Current goal text, so editing can hand it back to the composer. */
  objective?: string;
  availableCommands?: readonly { name: string }[];
}

interface ProgressControlTransport {
  cancelTurn(input: {
    session_id: string;
    turn_id: string;
  }): void | Promise<void>;
  runCommand(input: {
    session_id: string;
    command: string;
    args?: string;
  }): void | Promise<void>;
  editGoal?(input: {
    session_id: string;
    objective: string;
  }): void | Promise<void>;
}

/** Resolve capability-specific control semantics outside the reusable GUI.
 * Harness identity is deliberately irrelevant; advertised commands are the
 * dependency boundary. */
export function composerProgressCallbacksForSessionCapabilities(
  context: ProgressCallbackContext,
  transport: ProgressControlTransport,
): ComposerProgressCallbacks {
  const supportsGoalCommand = context.availableCommands?.some(
    (command) => command.name.trim().replace(/^\/+/, "").toLowerCase() === "goal",
  );
  if (context.progressKind !== "goal" || !supportsGoalCommand) {
    return {};
  }

  // Editing reopens the objective in the composer. Codex refuses to overwrite
  // an unfinished goal, so the old one is cleared first and the text handed
  // back for a word to be changed rather than retyped.
  const edit = context.objective && transport.editGoal
    ? () => transport.editGoal!({
      session_id: context.sessionId,
      objective: context.objective!,
    })
    : undefined;

  const status = context.status?.trim().toLowerCase();
  if (status === "paused") {
    return {
      ...(edit ? { edit } : {}),
      resume: () =>
        transport.runCommand({
          session_id: context.sessionId,
          command: "goal",
          args: "resume",
        }),
    };
  }
  if (status !== "active" && status !== "in_progress") return {};

  return {
    ...(edit ? { edit } : {}),
    pause: async () => {
      if (context.activeTurnId) {
        await transport.cancelTurn({
          session_id: context.sessionId,
          turn_id: context.activeTurnId,
        });
      }
      await transport.runCommand({
        session_id: context.sessionId,
        command: "goal",
        args: "pause",
      });
    },
  };
}
