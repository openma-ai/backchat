import type { AcpAvailableCommand } from "./session-types";

/** Imperative handle for putting text into the composer from outside it.
 *
 * Mirrors the right-rail handle: the progress bar and the composer are siblings
 * under ChatView, and threading a prop pair through both to move one string
 * would make every render of one depend on the other. */
export interface ComposerPrefill {
  sessionId: string | null;
  text: string;
  /** Command to arm alongside the text, so submitting re-invokes it. */
  armCommand?: AcpAvailableCommand;
}

type Handler = (prefill: ComposerPrefill) => void;

let handler: Handler | null = null;

export function bindComposerPrefill(next: Handler | null): void {
  handler = next;
}

export function prefillComposer(prefill: ComposerPrefill): void {
  handler?.(prefill);
}
