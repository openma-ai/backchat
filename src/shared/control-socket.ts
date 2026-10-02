import { homedir } from "node:os";
import { join } from "node:path";

/** Root shared by Backchat and OMA. BACKCHAT_HOME remains test-only so E2E
 * processes cannot read or mutate the developer's real local state. */
export function backchatStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const testHome = env["BACKCHAT_HOME"];
  if (env["BACKCHAT_TEST_HOOKS"] === "1" && testHome) return testHome;
  return join(homedir(), ".oma");
}

/** Unix socket (or Windows named pipe) for the local control server.
 * Override with BACKCHAT_CONTROL_SOCK. There is no TCP port. */
export function controlSocketPath(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  const override = env["BACKCHAT_CONTROL_SOCK"];
  if (override && override.trim()) return override.trim();
  if (platform === "win32") {
    const user = (env["USERNAME"] || env["USER"] || "user").replace(/[^A-Za-z0-9_.-]/g, "_");
    return `\\\\.\\pipe\\backchat-control-${user}`;
  }
  return join(backchatStorageRoot(env), "control.sock");
}
