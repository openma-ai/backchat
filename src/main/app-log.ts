import { trace } from "@opentelemetry/api";
import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Persistent app diagnostics: one JSON line per record in
 * `<root>/logs/backchat.log`.
 *
 * Every record carries `timestamp`, `level`, `component` and `event`, plus
 * `trace_id`/`span_id` when written inside an active span. The file rotates
 * when it passes `maxFileBytes` or the local day changes; rotated files
 * (`backchat-YYYYMMDD-HHMMSS.log`) are deleted once older than `maxAgeDays`
 * or beyond `maxTotalBytes` together. Only files this module named are ever
 * deleted.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppLogRetention {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxAgeDays: number;
}

export const DEFAULT_APP_LOG_RETENTION: AppLogRetention = {
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  maxAgeDays: 7,
};

export interface LogOptions {
  level?: LogLevel;
  /** Process that produced the record (default `main`). */
  component?: string;
}

const ACTIVE_NAME = "backchat.log";
const ROTATED_NAME = /^backchat-(\d{8})-(\d{6})(?:-\d+)?\.log$/;

interface LogTarget {
  dir: string;
  retention: AppLogRetention;
  /** Size and local day of the active file; unknown until first write. */
  bytes?: number;
  day?: string;
}

let target: LogTarget | null = null;
let pendingWrite: Promise<void> = Promise.resolve();
let now: () => Date = () => new Date();

export function configureAppLog(
  root: string | null,
  options: { retention?: Partial<AppLogRetention>; clock?: () => Date } = {},
): void {
  target = root
    ? { dir: join(root, "logs"), retention: { ...DEFAULT_APP_LOG_RETENTION, ...options.retention } }
    : null;
  now = options.clock ?? (() => new Date());
}

function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function localStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${localDay(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function rotate(log: LogTarget, at: Date): Promise<void> {
  const active = join(log.dir, ACTIVE_NAME);
  const stamp = localStamp(at);
  for (let attempt = 0; ; attempt += 1) {
    const rotated = join(log.dir, `backchat-${stamp}${attempt ? `-${attempt}` : ""}.log`);
    const exists = await stat(rotated).then(() => true, () => false);
    if (exists) continue;
    await rename(active, rotated).catch(() => undefined);
    break;
  }
  log.bytes = 0;
  log.day = localDay(at);
  await prune(log, at);
}

async function prune(log: LogTarget, at: Date): Promise<void> {
  const names = (await readdir(log.dir).catch(() => [] as string[])).filter((name) => ROTATED_NAME.test(name));
  const files = await Promise.all(names.map(async (name) => {
    const info = await stat(join(log.dir, name)).catch(() => undefined);
    return info ? { name, size: info.size, mtime: info.mtimeMs } : undefined;
  }));
  const newestFirst = files
    .filter((file): file is NonNullable<typeof file> => file !== undefined)
    .sort((a, b) => b.name.localeCompare(a.name));
  const oldest = at.getTime() - log.retention.maxAgeDays * 24 * 60 * 60 * 1000;
  let total = log.bytes ?? 0;
  for (const file of newestFirst) {
    total += file.size;
    if (file.mtime < oldest || total > log.retention.maxTotalBytes) {
      await unlink(join(log.dir, file.name)).catch(() => undefined);
    }
  }
}

async function write(log: LogTarget, line: string, at: Date): Promise<void> {
  await mkdir(log.dir, { recursive: true });
  const active = join(log.dir, ACTIVE_NAME);
  if (log.bytes === undefined) {
    const info = await stat(active).catch(() => undefined);
    log.bytes = info?.size ?? 0;
    log.day = localDay(info ? info.mtime : at);
  }
  const size = Buffer.byteLength(line);
  if (log.bytes > 0 && (log.day !== localDay(at) || log.bytes + size > log.retention.maxFileBytes)) {
    await rotate(log, at);
  }
  await appendFile(active, line, "utf8");
  log.bytes += size;
}

export function logAppEvent(
  event: string,
  fields: Record<string, unknown> = {},
  options: LogOptions = {},
): void {
  const log = target;
  if (!log) return;
  const at = now();
  const span = trace.getActiveSpan()?.spanContext();
  const line = `${JSON.stringify({
    timestamp: at.toISOString(),
    level: options.level ?? "info",
    component: options.component ?? "main",
    event,
    // Fields win: a span summary carries its own ids, not the active span's.
    ...(span && trace.isSpanContextValid(span) ? { trace_id: span.traceId, span_id: span.spanId } : {}),
    ...fields,
  })}\n`;
  const run = () => write(log, line, at);
  pendingWrite = pendingWrite.then(run, run).catch(() => undefined);
}

export function flushAppLog(): Promise<void> {
  return pendingWrite;
}
