import type { ControlErrorCode } from "../../shared/control-protocol.js";

export class ControlError extends Error {
  readonly data?: unknown;

  constructor(
    readonly code: ControlErrorCode,
    message: string,
    data?: unknown,
  ) {
    super(message);
    this.name = "ControlError";
    this.data = data;
  }
}

export function asControlError(error: unknown): ControlError {
  if (error instanceof ControlError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return new ControlError("not_found", message);
  if (/required|must be absolute|invalid|uncommitted changes|cannot be deleted|not managed/i.test(message)) {
    return new ControlError("invalid_args", message);
  }
  return new ControlError("error", message);
}
