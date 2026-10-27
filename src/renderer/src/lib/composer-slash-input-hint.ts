import type { AcpAvailableCommand } from "./session-store";
import { slashCommandConfigAction } from "./composer-slash-commands";

/** A slash command's declared argument hint, resolved for the text the user
 *  has typed so far.
 *
 *  ACP's `AvailableCommand.input.hint` is the agent telling the client what
 *  the command expects after its name — Codex's `/review` says "optional
 *  review instructions", Claude's `/adapt` says "[target] [context ...]".
 *  The composer shows it as muted ghost text right after the typed command
 *  and completes it on Tab. */
export interface SlashInputHint {
  /** The command name without the leading slash, exactly as the catalogue
   *  spells it (`review`, `review-branch`, `adapt`). */
  commandName: string;
  /** The declared hint, trimmed. Empty hints are not hints. */
  hint: string;
  /** The command token as typed, e.g. `/review`. */
  prefix: string;
}

/** The typed text has to be the bare command for the hint to apply: `/name`
 *  or `/name` plus trailing spaces. Anything else means the user has already
 *  started the argument, and a ghost would lie about what is in the box.
 *
 *  Leading whitespace is not accepted: the slash picker does not open for it
 *  either, so a ghost there would have no command to belong to. */
const BARE_COMMAND = /^\/(\S+)[ \t]*$/u;

/** The hint a bare command declares, or null when there is none to show.
 *
 *  Mirrors `pendingArgumentCommand`: a command is only waiting for an
 *  argument when it declares `input`, and a session-state switch is complete
 *  without one. On top of that the hint itself has to exist — `input` with
 *  no hint is a command that takes free text, not a command that suggests
 *  one.
 *
 *  `dismissed` is the composer's own state: Escape hides the ghost, and the
 *  caller asks for the resolved hint without it. */
export function resolveSlashInputHint({
  text,
  commands,
  dismissed = false,
}: {
  text: string;
  commands: readonly AcpAvailableCommand[];
  dismissed?: boolean;
}): SlashInputHint | null {
  if (dismissed) return null;
  const match = BARE_COMMAND.exec(text);
  if (!match) return null;
  const commandName = match[1]!;
  // The catalogue owns the spelling: a case-insensitive match would offer a
  // hint for a command the agent never published under that name.
  const command = commands.find((candidate) => candidate.name === commandName);
  if (!command?.input) return null;
  // A config switch is complete without an argument, so it never waits for
  // the hint to be typed.
  if (slashCommandConfigAction(command)) return null;
  const hint = command.input.hint?.trim();
  if (!hint) return null;
  return { commandName, hint, prefix: `/${commandName}` };
}

/** The result of completing a command with its hint. */
export interface SlashInputHintApplication {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Write the hint into the composer as real text.
 *
 *  The command keeps exactly one space between its name and the hint, so
 *  `/review` and `/review ` both complete to `/review optional review
 *  instructions`. The inserted hint is selected: the user can type over it,
 *  and Enter sends it as the argument. */
export function applySlashInputHint(
  text: string,
  hint: string,
): SlashInputHintApplication {
  const prefix = text.replace(/[ \t]+$/u, "");
  const completed = `${prefix} ${hint}`;
  return {
    text: completed,
    selectionStart: prefix.length + 1,
    selectionEnd: completed.length,
  };
}
