/**
 * IPC channel names — strings live in one place so renderer and main both
 * import from here. Adding a new channel: name it, add it to whichever
 * `*Channel` const matches its direction, register the handler in main,
 * surface the typed call in preload.
 */

export const InvokeChannel = {
  Ping: "app:ping",
  AgentsList: "agents:list",
  AgentInstall: "agent:install",
  AgentUpgrade: "agent:upgrade",
  AgentUninstall: "agent:uninstall",
  AgentAuthenticate: "agent:authenticate",
  SessionStart: "session:start",
  SessionPrompt: "session:prompt",
  SessionSetConfigOption: "session:setConfigOption",
  SessionCancel: "session:cancel",
  SessionDispose: "session:dispose",
  SessionAnnounce: "session:announce",
  PairStart: "pair:start",
  PairPrompt: "pair:prompt",
  PairCancel: "pair:cancel",
  PairDispose: "pair:dispose",
  PairReleaseMember: "pair:releaseMember",
  PairsList: "pairs:list",
  PairSave: "pair:save",
  SessionsList: "sessions:list",
  SessionsLoadHistory: "sessions:loadHistory",
  SideWorkspacesList: "sideWorkspaces:list",
  SideWorkspaceSave: "sideWorkspace:save",
  SideWorkspaceDelete: "sideWorkspace:delete",
  SessionsSearch: "sessions:search",
  ActivityStats: "activity:stats",
  SessionsPin: "sessions:pin",
  SessionsUnpin: "sessions:unpin",
  SessionsArchive: "sessions:archive",
  SessionsUnarchive: "sessions:unarchive",
  SessionsListArchived: "sessions:listArchived",
  SessionsDelete: "sessions:delete",
  SettingsGet: "settings:get",
  SettingsPatch: "settings:patch",
  McpAppResolve: "mcpApp:resolve",
  McpAppRequest: "mcpApp:request",
  InlineVisualizationRead: "inlineVisualization:read",
  InlineVisualizationRegisterDocument: "inlineVisualization:registerDocument",
  InlineVisualizationWatch: "inlineVisualization:watch",
  InlineVisualizationUnwatch: "inlineVisualization:unwatch",
  PermissionRespond: "permission:respond",
  FsApprovalRespond: "fs:approvalRespond",
  BrokerPendingAsks: "broker:pendingAsks",
  /** User-facing terminal — distinct from the ACP-driven terminal/* family
   *  in brokers.ts (those are command-runners for agents; UiTerm is a
   *  pty-backed interactive shell shown in the bottom panel). */
  UiTermSpawn: "uiTerm:spawn",
  UiTermInput: "uiTerm:input",
  UiTermResize: "uiTerm:resize",
  UiTermDispose: "uiTerm:dispose",
  BrowserElementPickerBegin: "browserElementPicker:begin",
  BrowserElementPickerHover: "browserElementPicker:hover",
  BrowserElementPickerCommit: "browserElementPicker:commit",
  BrowserElementPickerCaptureRegion: "browserElementPicker:captureRegion",
  BrowserElementPickerCancel: "browserElementPicker:cancel",
  BrowserViewRegister: "browserView:register",
  BrowserViewUnregister: "browserView:unregister",
  BrowserViewSetActive: "browserView:setActive",
  BrowserCaptureScreenshot: "browserData:captureScreenshot",
  BrowserShowDeviceToolbar: "browserData:showDeviceToolbar",
  BrowserClearData: "browserData:clearData",
  BrowserClearProfileData: "browserData:clearProfileData",
  BrowserDownloadsList: "browserData:downloadsList",
  BrowserDownloadAction: "browserData:downloadAction",
  BrowserCredentialsList: "browserData:credentialsList",
  BrowserCredentialFill: "browserData:credentialFill",
  BrowserCredentialDelete: "browserData:credentialDelete",
  /** Directory listing — side-panel file tree reads a path's children
   *  (one level at a time, lazy-expand). Returns name + isDir; the
   *  renderer is responsible for handling errors (permission denied,
   *  symlink loops) and showing them inline. */
  UiFsListDir: "uiFs:listDir",
  /** $HOME (or %USERPROFILE% on Windows). Used by the file tree as a
   *  default root when no chat session has assigned a cwd yet. */
  UiFsHome: "uiFs:home",
  /** Native "Choose folder" picker. Returns the picked absolute
   *  path, or null if the user cancelled. */
  UiFsPickDir: "uiFs:pickDir",
  /** Native file picker for prompt attachments. Returns selected
   *  images/files with metadata and small image preview data. */
  UiFsPickFiles: "uiFs:pickFiles",
  /** Persist a renderer-generated PNG (for example a browser element
   *  annotation) and return it as an ordinary prompt attachment. */
  UiFsSaveCapture: "uiFs:saveCapture",
  /** Recent entries in a directory — list children, sort by mtime
   *  (newest first), return the top N. Used by the side-panel empty
   *  state "推荐" feed to surface what the user is actually working
   *  on in the current workspace. */
  UiFsRecent: "uiFs:recent",
  /** Open an arbitrary path with the OS-default handler
   *  (`shell.openPath`). Used by the preview surface's Open in action
   *  and as a fallback for files without an in-app preview. */
  UiFsOpenPath: "uiFs:openPath",
  /** Reveal a file in the host file manager without opening it. */
  UiFsRevealPath: "uiFs:revealPath",
  /** Resolve a local file to an in-app preview, preserving the source
   *  path as the native Open in target. */
  UiFsResolvePreview: "uiFs:resolvePreview",
  /** Read the current git branch for a workspace dir. Returns the
   *  branch name (e.g. "main"), or null if the path isn't a git
   *  repo or the read fails. Used by the composer's branch chip. */
  UiFsGitBranch: "uiFs:gitBranch",

  /** Dev-only test hooks. ONLY registered when env BACKCHAT_TEST_HOOKS=1
   *  is set at main startup. Used by e2e tests to inject canned session
   *  events into the store without spawning a real ACP child. NOT a
   *  production surface — production builds should never see these
   *  channels reach ipcMain. */
  TestInjectSessionRow: "__test:injectSessionRow",
  TestInjectSessionEvent: "__test:injectSessionEvent",
  TestPersistSessionFixture: "__test:persistSessionFixture",
  TestExportSessionFiles: "__test:exportSessionFiles",
  TestReadSessionPrompts: "__test:readSessionPrompts",
  TestReadSessionConfigOptions: "__test:readSessionConfigOptions",
  TestSetPickedFiles: "__test:setPickedFiles",
  TestSetAgentSetupFixture: "__test:setAgentSetupFixture",
  TestAgentSetupCalls: "__test:agentSetupCalls",
  TestBrowserTool: "__test:browserTool",
} as const;

export const PushChannel = {
  /** Out-of-band push for session lifecycle + streamed events. */
  SessionEvent: "session:event",
  /** Pair-chat lifecycle + per-member streamed events. Distinct
   *  channel so single-chat reducers don't have to filter them. */
  PairEvent: "pair:event",
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
  /** User-facing terminal — batched stdout/stderr chunks pushed to the
   *  bottom-panel xterm.js renderer. One push may carry many pty data
   *  events (batched at ~16ms to match a render frame). */
  UiTermData: "uiTerm:data",
  /** User-facing terminal exited (success or signal). */
  UiTermExit: "uiTerm:exit",
  /** Menu → renderer: route the user to a path (e.g. "/settings"). */
  MenuNavigate: "menu:navigate",
  /** Menu → renderer: trigger a renderer action. Payload is a short
   *  string code: "new-chat" | "command-palette". */
  MenuAction: "menu:action",
  /** Browser harness → renderer. Keeps tool-created tabs in the same
   *  task-scoped right-rail browser window the user can see. */
  BrowserToolTabCommand: "browserTool:tabCommand",
  /** Browser download progress for the task-scoped in-app browser. */
  BrowserDownloadsChanged: "browserData:downloadsChanged",
  /** A watched generative-UI fragment changed on disk. */
  InlineVisualizationChanged: "inlineVisualization:changed",
} as const;

export type InvokeChannelName = (typeof InvokeChannel)[keyof typeof InvokeChannel];
export type PushChannelName = (typeof PushChannel)[keyof typeof PushChannel];
