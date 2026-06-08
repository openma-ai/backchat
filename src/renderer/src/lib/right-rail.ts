/**
 * right-rail — module-level imperative handle for the right-side panel's
 * collapse state. Lets non-React code (the session store's auto-open
 * paths, plain helper modules) force the panel open before pushing a
 * tab the user wouldn't otherwise see.
 *
 * ShellLayout binds the actual setter on mount via `bindRightRailSetter`;
 * before that, calls are silently dropped (matches the "no shell, no
 * effect" expectation during boot or in tests that don't mount the
 * layout).
 *
 * Kept in `lib/` rather than colocated with AppShell so leaf modules
 * (session-store, side-panel helpers) can import it without dragging in
 * the AppShell render tree.
 */

let setter: ((value: boolean) => void) | null = null;

export function bindRightRailSetter(fn: (value: boolean) => void): () => void {
  setter = fn;
  return () => {
    if (setter === fn) setter = null;
  };
}

/** Force the right rail open (false) or collapsed (true). No-op when
 *  the provider hasn't mounted yet. */
export function setRightRailCollapsed(value: boolean): void {
  setter?.(value);
}
