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

/** Commands whose invocation is worth labelling, per harness, with the control
 * words their argument can be instead of content.
 *
 * Keyed by harness because ACP v1 has no marker for this: the official docs
 * show a prompt-style /goal, so another agent's /goal is an ordinary prompt and
 * must stay unlabelled. The control words are also kept here because a freshly
 * created session has not published its catalogue yet — waiting for it would
 * leave the first message showing raw `/goal …` until the round trip lands.
 * A live hint still wins when there is one. */
const ANNOTATED_COMMANDS: Record<string, Record<string, readonly string[]>> = {
  "codex-acp": { goal: ["clear", "pause", "resume"] },
};

/** Literal choices a command's hint offers, as opposed to its placeholders.
 * Codex hints `[<objective>|clear|pause|resume]`: only `<objective>` is
 * content, the rest are control words. `/goal clear` is therefore not a goal
 * being set — and the composer's own exit fallback sends exactly that — so
 * relabelling it "sent as goal" would invert its meaning. */
function literalHintChoices(hint: string | undefined): string[] {
  if (!hint) return [];
  return hint
    .replace(/^\[|\]$/gu, "")
    .split("|")
    .map((choice) => choice.trim())
    .filter((choice) => choice.length > 0 && !choice.startsWith("<"));
}

export function promptCommandAnnotation(
  promptText: string | undefined,
  agentId: string | undefined,
  commands: readonly {
    name: string;
    input?: { hint?: string } | null;
  }[] = [],
): PromptCommandAnnotation | undefined {
  if (!promptText) return undefined;
  const match = /^\/([A-Za-z0-9_-]+)[ \t]+([\s\S]+)$/u.exec(promptText.trim());
  if (!match) return undefined;
  const [, command, body] = match;
  const known = agentId ? ANNOTATED_COMMANDS[agentId]?.[command] : undefined;
  if (!known) return undefined;
  const trimmedBody = body.trim();
  if (!trimmedBody) return undefined;
  const advertised = commands.find((candidate) => candidate.name === command);
  const controlWords = literalHintChoices(advertised?.input?.hint);
  if ((controlWords.length > 0 ? controlWords : known).includes(trimmedBody)) {
    return undefined;
  }
  return { command, body: trimmedBody };
}
