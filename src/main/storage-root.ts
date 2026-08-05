import { homedir } from "node:os";
import { join } from "node:path";

/** Root shared by Backchat and OMA. BACKCHAT_HOME remains test-only so E2E
 * processes cannot read or mutate the developer's real local state. */
export function openmaRoot(): string {
  const testHome = process.env["BACKCHAT_HOME"];
  if (process.env["BACKCHAT_TEST_HOOKS"] === "1" && testHome) {
    return testHome;
  }
  return join(homedir(), ".oma");
}
