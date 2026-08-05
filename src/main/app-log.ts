import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

let logPath: string | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

export function configureAppLog(root: string | null): void {
  logPath = root ? join(root, "logs", "backchat.log") : null;
}

export function logAppEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const target = logPath;
  if (!target) return;
  const line = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  })}\n`;
  const write = async () => {
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, line, "utf8");
  };
  pendingWrite = pendingWrite.then(write, write).catch(() => undefined);
}

export function flushAppLog(): Promise<void> {
  return pendingWrite;
}
