import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export function pr56AcceptancePhase(): "before" | "after" {
  const phase = process.env.PR56_ACCEPTANCE_PHASE ?? "after";
  return phase === "before" ? "before" : "after";
}

export function pr56AcceptanceRoot(): string {
  return process.env.PR56_ACCEPTANCE_ROOT ?? "/opt/cursor/artifacts/pr56-acceptance";
}

export function pr56ShotPath(filename: string): string {
  return join(pr56AcceptanceRoot(), pr56AcceptancePhase(), filename);
}

export async function ensurePr56AcceptanceDir(): Promise<string> {
  const dir = join(pr56AcceptanceRoot(), pr56AcceptancePhase());
  await mkdir(dir, { recursive: true });
  return dir;
}
