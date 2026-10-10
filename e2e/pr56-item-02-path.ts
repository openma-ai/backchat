import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export function pr56Item02Phase(): "before" | "after" {
  const phase = process.env.PR56_ITEM_02_PHASE ?? "after";
  return phase === "before" ? "before" : "after";
}

export function pr56Item02Root(): string {
  return process.env.PR56_ITEM_02_ROOT ?? "/opt/cursor/artifacts/pr56-item-02";
}

export function pr56Item02Shot(filename: string): string {
  return join(pr56Item02Root(), pr56Item02Phase(), filename);
}

export async function ensurePr56Item02Dir(): Promise<string> {
  const dir = join(pr56Item02Root(), pr56Item02Phase());
  await mkdir(dir, { recursive: true });
  return dir;
}
