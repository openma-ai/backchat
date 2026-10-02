/**
 * Chrome DevTools remote debugging.
 *
 * Packaged Electron leaves NODE_ENV unset, and electron-vite does not
 * inline a bracket-style environment read. Treating "anything except
 * production" as dev therefore opens a debugging port in the shipped
 * app. Gate the default port on the dev bundle and `app.isPackaged`
 * instead. A packaged app opens a port only when
 * BACKCHAT_REMOTE_DEBUGGING_PORT is an explicit TCP port, and then only
 * on 127.0.0.1.
 */

export const REMOTE_DEBUGGING_OPT_IN_ENV = "BACKCHAT_REMOTE_DEBUGGING_PORT";
export const DEV_REMOTE_DEBUGGING_PORT = "9222";
export const LOOPBACK_REMOTE_DEBUGGING_ADDRESS = "127.0.0.1";

export interface RemoteDebuggingTarget {
  port: string;
  address: typeof LOOPBACK_REMOTE_DEBUGGING_ADDRESS;
  /**
   * Non-browser CDP clients fail Chromium's DevTools origin check without
   * this. It is applied only when a port is intentionally opened.
   */
  allowOrigins: "*";
}

export interface RemoteDebuggingInput {
  /** Electron `app.isPackaged`. */
  isPackaged: boolean;
  /**
   * `import.meta.env.DEV` from electron-vite. True for `electron-vite dev`
   * only, not for the production bundle used by packaged apps and Playwright.
   */
  devBuild: boolean;
  env: Readonly<Record<string, string | undefined>>;
}

export function resolveRemoteDebugging(
  input: RemoteDebuggingInput,
): RemoteDebuggingTarget | null {
  const rawOptIn = input.env[REMOTE_DEBUGGING_OPT_IN_ENV];
  const optedIn = parseOptInPort(rawOptIn);
  if (optedIn) return target(optedIn);
  // A present but invalid opt-in must not fall through to the dev port.
  if (hasOptInAttempt(rawOptIn)) return null;
  if (input.isPackaged || input.devBuild !== true) return null;
  // Playwright opens its own CDP port. The dev default would collide with it.
  if (input.env["BACKCHAT_TEST_HOOKS"] === "1") return null;
  return target(DEV_REMOTE_DEBUGGING_PORT);
}

function target(port: string): RemoteDebuggingTarget {
  return {
    port,
    address: LOOPBACK_REMOTE_DEBUGGING_ADDRESS,
    allowOrigins: "*",
  };
}

function hasOptInAttempt(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function parseOptInPort(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!/^[1-9]\d{0,4}$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port > 65535) return null;
  return String(port);
}
