import { appendFileSync } from "node:fs";
import { updateEvidencePath } from "../shared/app-update.js";

/** Append one JSON line for the macOS update e2e. No-op unless that e2e is running. */
export function recordUpdateEvidence(
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
): void {
  const path = updateEvidencePath(process.env);
  if (!path) return;
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    pid: process.pid,
    ...fields,
  })}\n`;
  appendFileSync(path, line);
}
