/** A prompt the user sent as a command invocation.
 *
 * ACP invokes commands by putting the command text in an ordinary prompt, so
 * "set my goal to X" goes out literally as `/goal X`. The composer adds that
 * prefix on the user's behalf, so echoing it back shows them plumbing they
 * never typed. Presentation splits it again: the argument is the message, the
 * command becomes a label beside it. */
export interface PromptCommandAnnotation {
  /** Command name without the leading slash. */
  command: string;
  /** The argument the user actually typed. */
  body: string;
}

/** Commands whose invocation is worth labelling, mapped to the state they
 * enter. Anything absent is left as plain prompt text rather than given
 * invented copy — the same table shape the armed composer chip uses, so adding
 * a command stays a data change. */
const ANNOTATED_COMMAND_STATES: Record<string, "goal"> = { goal: "goal" };

export function promptCommandAnnotation(
  promptText: string | undefined,
  commands: readonly string[],
): PromptCommandAnnotation | undefined {
  if (!promptText) return undefined;
  const match = /^\/([A-Za-z0-9_-]+)[ \t]+([\s\S]+)$/u.exec(promptText.trim());
  if (!match) return undefined;
  const [, command, body] = match;
  // Only annotate a command this session actually advertises, so a message
  // that merely starts with a slash is left alone.
  if (!commands.includes(command)) return undefined;
  if (!ANNOTATED_COMMAND_STATES[command]) return undefined;
  const trimmedBody = body.trim();
  if (!trimmedBody) return undefined;
  return { command, body: trimmedBody };
}
