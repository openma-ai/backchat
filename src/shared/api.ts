/**
 * Renderer-facing surface exposed via contextBridge.
 *
 * Renderer code reads this type via `window.openma`. Main process owns the
 * implementation; preload script wires the two together. Keep the surface
 * narrow — every new method is a permission boundary.
 */
export interface OpenmaApi {
  /** Smoke test for the IPC channel; main returns the string it was sent. */
  ping(msg: string): Promise<string>;
}

declare global {
  interface Window {
    openma: OpenmaApi;
  }
}
