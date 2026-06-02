/**
 * IPC channel names — strings live in one place so renderer and main both
 * import from here. Adding a new channel: name it, add it to whichever
 * `*Channel` const matches its direction, register the handler in main,
 * surface the typed call in preload.
 */

export const InvokeChannel = {
  Ping: "app:ping",
  AgentsList: "agents:list",
  SessionStart: "session:start",
  SessionPrompt: "session:prompt",
  SessionCancel: "session:cancel",
  SessionDispose: "session:dispose",
  SessionAnnounce: "session:announce",
  SessionsList: "sessions:list",
  SessionsLoadHistory: "sessions:loadHistory",
  SettingsGet: "settings:get",
  SettingsPatch: "settings:patch",
  PermissionRespond: "permission:respond",
  FsApprovalRespond: "fs:approvalRespond",
} as const;

export const PushChannel = {
  /** Out-of-band push for session lifecycle + streamed events. */
  SessionEvent: "session:event",
  /** Whole-settings push fired after each patch — renderer subscribes once
   *  and re-renders settings-driven UI without polling. */
  SettingsChanged: "settings:changed",
  /** Permission ask from a running ACP child. Renderer surfaces a modal,
   *  user picks → PermissionRespond invoke routes the decision back. */
  PermissionRequest: "permission:request",
  /** Out-of-cwd file write request — same pattern. Renderer shows a
   *  diff/approval modal, replies via FsApprovalRespond. */
  FsWriteApproval: "fs:writeApproval",
  /** Per-terminal output frames pushed for live rendering. */
  TerminalOutput: "terminal:output",
  /** Terminal exited (success or signal). */
  TerminalExit: "terminal:exit",
} as const;

export type InvokeChannelName = (typeof InvokeChannel)[keyof typeof InvokeChannel];
export type PushChannelName = (typeof PushChannel)[keyof typeof PushChannel];
