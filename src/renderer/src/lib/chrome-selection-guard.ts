/**
 * Chromium's multi-click selection (double-click word, triple-click
 * paragraph) resolves through `user-select: none` chrome onto the nearest
 * selectable text — rapidly toggling a composer chip would paint a
 * paragraph of the transcript blue. Enumerating controls is not enough:
 * while a Radix layer holds `pointer-events: none`, the repeated
 * mousedown's target is the document root rather than the control. So the
 * rule is inverted: a multi-click may only start inside content that has
 * opted into selection. Keep this allowlist in sync with the selection
 * policy in styles/index.css.
 */
const SELECTABLE_CONTENT =
  "input, textarea, [contenteditable='true'], .chat-turn-frame, pre, code, [data-selectable='true']";

export function installChromeSelectionGuard(
  target: Pick<Document, "addEventListener" | "removeEventListener">,
): () => void {
  const guard = (event: MouseEvent) => {
    if (event.detail < 2) return;
    const origin = event.target instanceof Element ? event.target : null;
    if (origin?.closest(SELECTABLE_CONTENT)) return;
    event.preventDefault();
  };
  target.addEventListener("mousedown", guard);
  return () => target.removeEventListener("mousedown", guard);
}
