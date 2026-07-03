/**
 * IPC channel names — strings live in one place so renderer and main both
 * import from here. Adding a new channel: name it, add it to whichever
 * `*Channel` const matches its direction, register the handler in main,
 * surface the typed call in preload.
 */

export const InvokeChannel = {
  Ping: "app:ping",
  AgentsList: "agents:list",
  /** Spin up a one-shot AcpSession just to read the agent's
   *  initialize.authMethods list, then dispose. Returns a small
   *  array of {id, name, description?} entries the Settings UI
   *  uses to render the sign-in picker. */
  AcpAuthMethods: "acp:authMethods",
  /** Spin up a one-shot AcpSession and call session.authenticate()
   *  with the chosen methodId. The agent runs its own sub-flow
   *  (OAuth browser handoff, API-key validation, ...). Resolves
   *  on success; rejects with the agent's raw error on failure. */
  AcpAuthenticate: "acp:authenticate",
  AgentProbe: "agent:probe",
  AgentInstall: "agent:install",
  AgentUpgrade: "agent:upgrade",
  AgentUninstall: "agent:uninstall",
  AgentAuthenticate: "agent:authenticate",
  AgentSetDefault: "agent:setDefault",
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
  SessionsSearch: "sessions:search",
  SessionsPin: "sessions:pin",
  SessionsUnpin: "sessions:unpin",
  SessionsArchive: "sessions:archive",
  SessionsUnarchive: "sessions:unarchive",
  SessionsListArchived: "sessions:listArchived",
  SessionsDelete: "sessions:delete",
  SettingsGet: "settings:get",
  SettingsPatch: "settings:patch",
  PermissionRespond: "permission:respond",
  FsApprovalRespond: "fs:approvalRespond",
  /** User-facing terminal — distinct from the ACP-driven terminal/* family
   *  in brokers.ts (those are command-runners for agents; UiTerm is a
   *  pty-backed interactive shell shown in the bottom panel). */
  UiTermSpawn: "uiTerm:spawn",
  UiTermInput: "uiTerm:input",
  UiTermResize: "uiTerm:resize",
  UiTermDispose: "uiTerm:dispose",
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
  /** Recent entries in a directory — list children, sort by mtime
   *  (newest first), return the top N. Used by the side-panel empty
   *  state "推荐" feed to surface what the user is actually working
   *  on in the current workspace. */
  UiFsRecent: "uiFs:recent",
  /** Open an arbitrary path with the OS-default handler
   *  (`shell.openPath`). Used to let the user open a file from the
   *  recent feed without us needing to ship a preview/editor. */
  UiFsOpenPath: "uiFs:openPath",
  /** Read the current git branch for a workspace dir. Returns the
   *  branch name (e.g. "main"), or null if the path isn't a git
   *  repo or the read fails. Used by the composer's branch chip. */
  UiFsGitBranch: "uiFs:gitBranch",
  BrowserList: "browser:list",
  BrowserGet: "browser:get",
  BrowserTabs: "browser:tabs",
  BrowserGetTab: "browser:getTab",
  BrowserSelectedTab: "browser:selectedTab",
  BrowserUserOpenTabs: "browser:userOpenTabs",
  BrowserSelectTab: "browser:selectTab",
  BrowserNameSession: "browser:nameSession",
  BrowserSessionName: "browser:sessionName",
  BrowserNewTab: "browser:newTab",
  BrowserGoto: "browser:goto",
  BrowserSetVisibility: "browser:setVisibility",
  BrowserGetVisibility: "browser:getVisibility",
  BrowserSetViewport: "browser:setViewport",
  BrowserResetViewport: "browser:resetViewport",
  BrowserAttachView: "browser:attachView",
  BrowserDetachView: "browser:detachView",
  BrowserReload: "browser:reload",
  BrowserBack: "browser:back",
  BrowserForward: "browser:forward",
  BrowserWaitForURL: "browser:waitForURL",
  BrowserWaitForLoadState: "browser:waitForLoadState",
  BrowserTitle: "browser:title",
  BrowserUrl: "browser:url",
  BrowserCloseTab: "browser:closeTab",
  BrowserScreenshot: "browser:screenshot",
  BrowserDevLogs: "browser:devLogs",
  BrowserPageAssets: "browser:pageAssets",
  BrowserBundleAssets: "browser:bundleAssets",
  BrowserDomSnapshot: "browser:domSnapshot",
  BrowserEvaluate: "browser:evaluate",
  BrowserClick: "browser:click",
  BrowserType: "browser:type",
  BrowserPress: "browser:press",
  BrowserCuaClick: "browser:cuaClick",
  BrowserDomCuaSnapshot: "browser:domCuaSnapshot",
  BrowserDomCuaClick: "browser:domCuaClick",
  BrowserLocatorCount: "browser:locatorCount",
  BrowserLocatorClick: "browser:locatorClick",
  BrowserLocatorFill: "browser:locatorFill",
  BrowserLocatorPress: "browser:locatorPress",
  BrowserLocatorSetChecked: "browser:locatorSetChecked",
  BrowserLocatorSelectOption: "browser:locatorSelectOption",
  BrowserLocatorInnerText: "browser:locatorInnerText",
  BrowserLocatorAttribute: "browser:locatorAttribute",
  BrowserDialog: "browser:dialog",
  BrowserAcceptDialog: "browser:acceptDialog",
  BrowserDismissDialog: "browser:dismissDialog",
  BrowserClipboardReadText: "browser:clipboardReadText",
  BrowserClipboardWriteText: "browser:clipboardWriteText",

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
  /** Main-process Browser plugin state changed; renderer mirrors visible IAB
   *  tabs into the right rail without owning the automation state. */
  BrowserState: "browser:state",
  /** Menu → renderer: route the user to a path (e.g. "/settings"). */
  MenuNavigate: "menu:navigate",
  /** Menu → renderer: trigger a renderer action. Payload is a short
   *  string code: "new-chat" | "command-palette". */
  MenuAction: "menu:action",
} as const;

export type InvokeChannelName = (typeof InvokeChannel)[keyof typeof InvokeChannel];
export type PushChannelName = (typeof PushChannel)[keyof typeof PushChannel];
