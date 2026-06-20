import { homedir } from "node:os";
import { join } from "node:path";

/** Root for Backchat's local state. BACKCHAT_HOME is intentionally test-only
 *  for now, so normal app launches keep using ~/.openma. */
export function openmaRoot(): string {
  const testHome = process.env["BACKCHAT_HOME"];
  if (process.env["BACKCHAT_TEST_HOOKS"] === "1" && testHome) {
    return testHome;
  }
  return join(homedir(), ".openma");
}

