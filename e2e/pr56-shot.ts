import { join } from "node:path";
import { pr56AcceptancePhase, pr56AcceptanceRoot } from "./pr56-acceptance-path";

/** PR acceptance captures use PR56_ACCEPTANCE_ROOT/{before|after}/; local runs use screenshots/. */
export function pr56Shot(filename: string): string {
  if (process.env.PR56_ACCEPTANCE_ROOT) {
    return join(pr56AcceptanceRoot(), pr56AcceptancePhase(), filename);
  }
  return join("/opt/cursor/artifacts/screenshots", filename);
}
