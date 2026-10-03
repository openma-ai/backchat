/**
 * ACP `ToolCallStatus` "completed" means the tool call finished. Cursor still
 * reports `completed` when a shell was rejected or a write was denied, so
 * callers must not read that status as success.
 *
 * The outcome comes from the permission decision or the tool result when
 * either is present. `finished` means the wire status was completed and
 * neither source said what happened.
 */

export type ToolCallOutcome = "ok" | "denied" | "failed" | "cancelled" | "finished";

const DENIED_TEXT = /write permission denied|permission denied|user rejected|rejected by user/i;

export function toolCallOutcome(update: Record<string, unknown>): ToolCallOutcome | undefined {
  const wire = lower(update.status);
  const exitCode = terminalExitCode(update);
  const terminal = wire === "completed"
    || wire === "complete"
    || wire === "failed"
    || wire === "error"
    || wire === "cancelled"
    || wire === "canceled"
    || exitCode !== undefined;
  if (!terminal) return undefined;
  if (wire === "cancelled" || wire === "canceled") return "cancelled";
  if (wire === "failed" || wire === "error") return "failed";
  if (permissionDenies(update)) return "denied";
  if (exitCode !== undefined) return exitCode === 0 ? "ok" : "failed";
  if (isErrorResult(update.rawOutput ?? update.raw_output)) return "failed";
  const text = toolResultText(update);
  if (text && DENIED_TEXT.test(text)) return "denied";
  if (text && /^(error|failed)\b/i.test(text.trim())) return "failed";
  if (permissionAllows(update)) return "ok";
  if (hasResult(update)) return "ok";
  if (wire === "completed" || wire === "complete") return "finished";
  return "finished";
}

export function toolResultText(update: Record<string, unknown>): string {
  const parts: string[] = [];
  pushText(parts, update.rawOutput ?? update.raw_output);
  pushText(parts, update.error);
  pushText(parts, update.text);
  const content = update.content;
  if (Array.isArray(content)) {
    for (const block of content) pushText(parts, block);
  }
  return parts.join("\n").trim();
}

function permissionDenies(update: Record<string, unknown>): boolean {
  const outcome = lower(update.permission_outcome);
  if (outcome === "cancelled" || outcome === "rejected" || outcome === "denied") return true;
  const kind = lower(update.option_kind ?? update.permission_option_kind);
  if (kind === "reject_once" || kind === "reject_always") return true;
  const optionId = lower(update.option_id ?? update.permission_option);
  return optionId === "reject" || optionId === "reject-once" || optionId === "reject_once";
}

function permissionAllows(update: Record<string, unknown>): boolean {
  if (lower(update.permission_outcome) !== "selected") return false;
  const kind = lower(update.option_kind ?? update.permission_option_kind);
  return kind === "allow_once" || kind === "allow_always";
}

function hasResult(update: Record<string, unknown>): boolean {
  if (toolResultText(update).length > 0) return true;
  const raw = update.rawOutput ?? update.raw_output;
  if (raw && typeof raw === "object" && !Array.isArray(raw) && !isErrorResult(raw)) {
    return Object.keys(raw).length > 0;
  }
  return Array.isArray(update.content) && update.content.some((block) => {
    if (!block || typeof block !== "object") return false;
    const type = (block as { type?: unknown }).type;
    return type === "diff" || type === "terminal";
  });
}

function isErrorResult(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.isError === true || record.is_error === true;
}

function terminalExitCode(update: Record<string, unknown>): number | undefined {
  const meta = record(update._meta);
  const exit = record(meta?.terminal_exit) ?? record(update.terminal);
  const code = exit?.exit_code ?? exit?.exitCode;
  return typeof code === "number" ? code : undefined;
}

function pushText(parts: string[], value: unknown): void {
  if (typeof value === "string") {
    if (value.trim()) parts.push(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) pushText(parts, entry);
    return;
  }
  const recordValue = value as Record<string, unknown>;
  if (typeof recordValue.text === "string") pushText(parts, recordValue.text);
  if (typeof recordValue.message === "string") pushText(parts, recordValue.message);
  if (typeof recordValue.error === "string") pushText(parts, recordValue.error);
  if (recordValue.content !== undefined) pushText(parts, recordValue.content);
  if (recordValue.data !== undefined && typeof recordValue.data !== "object") {
    pushText(parts, recordValue.data);
  }
}

function lower(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.toLowerCase() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
