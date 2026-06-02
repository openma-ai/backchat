/**
 * IPC channel names — strings live in one place so renderer and main both
 * import from here. Adding a new channel: name it, add it to whichever
 * `*Channel` const matches its direction, register the handler in main,
 * surface the typed call in preload.
 */

export const InvokeChannel = {
  // Phase 1: nothing yet. Future:
  // SessionList: "session:list",
  // SessionStart: "session:start",
  // SessionPrompt: "session:prompt",
  // SessionCancel: "session:cancel",
  // SessionDispose: "session:dispose",
  Ping: "app:ping",
} as const;

export const PushChannel = {
  // Future:
  // SessionEvent: "session:event",
  // PermissionRequest: "permission:request",
} as const;

export type InvokeChannelName = (typeof InvokeChannel)[keyof typeof InvokeChannel];
export type PushChannelName = (typeof PushChannel)[keyof typeof PushChannel];
