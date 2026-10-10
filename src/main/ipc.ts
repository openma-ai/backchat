import { ProjectCloudRouter } from './project-cloud.js';
import type { OpenmaAccount } from './openma-account.js';
import { ProjectWorkService } from "./project-work.js";
import { ProjectAgentBridge } from "./project-agent.js";
import { ProjectMcpBridge } from "./project-mcp.js";
import type { OpenMAEvent as ProjectAgentEvent } from "@openmatter/agent";
/**
 * IPC handler registration — bridges main's SessionManager to the renderer.
 *
 * Renderer calls `window.backchat.foo(...)` (preload), which `ipcRenderer.invoke`s
 * into one of these handlers. Outbound `session.event` etc. are pushed via
 * `webContents.send` from the SessionManager's `Sender` callback.
 */

import { app, BrowserWindow, ipcMain, Notification, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { OpenMAEvent } from "@openma/common/session-events/openma";
import { getKnownAgents } from "@open-managed-agents-desktop/acp/registry";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import type {
  AgentInfo,
  AgentListOptions,
  PairSaveParams,
  PersistedEventInfo,
  PersistedPairInfo,
  PersistedSessionInfo,
  PersistedSideWorkspaceInfo,
  SessionHistoryPage,
  SideWorkspaceSaveParams,
} from "../shared/api.js";
import type { ProjectInfo, ProjectSaveParams } from "../shared/projects.js";
import type {
  SessionEventOut,
  SessionPromptParams,
  SessionPromptQueueCommandParams,
  SessionRunCommandParams,
  SessionRestartResult,
  SessionRuntimeStatus,
  SessionRequestExtensionParams,
  SessionSetConfigOptionParams,
  SessionStartParams,
} from "../shared/session-events.js";
import type {
  PairEventOut,
  PairPromptParams,
  PairStartParams,
} from "../shared/pair-events.js";
import type { Settings, SettingsMcpServer } from "../shared/settings.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "../shared/schedules.js";
import { createAgentSetupService, launchTerminalAuth } from "./agent-setup.js";
import { SessionManager } from "./session-manager.js";
import { PairManager } from "./pair-manager.js";
import { settingsStore } from "./settings-store.js";
import { appendEvent, appendEventsTx, archivePairSession, archiveSession, deleteProject, deleteSession, deleteSideWorkspace, getActivityStats, getProject, getSession, listArchivedSessions, listPairGroups, listProjects, listSessions, listSideWorkspaces, loadHistory, loadHistoryPage, pinPairSession, pinSession, renameSession, savePairGroup, saveSideWorkspace, searchMessages, setSessionExternalClient, setSessionTitleIfEmpty, unarchivePairSession, unarchiveSession, unpinPairSession, unpinSession, upsertSession } from "./sql-store.js";
import type { PersistedSession } from "./sql-store.js";
import { enrichActivityStats } from "./activity-stats.js";
import { removeSessionCwd } from "./session-cwd.js";
import { workspaceService } from "./workspace-service.js";
import type { WorkspaceCreateParams, WorkspaceInfo } from "../shared/workspaces.js";
import { exportSessionFiles as exportSessionFilesToDisk } from "./file-first-export.js";
import { openmaRoot } from "./storage-root.js";
import { controlSocketPath } from "../shared/control-socket.js";
import { createControlApi, disposeProjectSessions, removeWorkspaceStoppingSessions } from "./control/handlers.js";
import { publishControlLiveEvent, streamEventsFromSession } from "./control/live-bus.js";
import {
  ensureExternalCoordinator,
  getExternalCoordinator,
  listExternalCoordinators,
  listExternalTasks,
  listSessionsForExternalCoordinator,
  removeExternalCoordinator,
} from "./sql-store.js";
import { withExternalWork } from "./control/handlers.js";
import { startControlServer, type ControlServer } from "./control/server.js";
import { installBackchatCli } from "./control/cli-install.js";
import { saveProjectCommand } from "./project-commands.js";
import { forwardSessionEventToPet } from "./pet-hook-bridge.js";
import {
  createSessionEventEnricher,
  hasOpenMAEventSchema,
  latestPersistedOpenMAEventSequence,
} from "./session-event-enricher.js";
import { logAppEvent } from "./app-log.js";
import { recordUpdateEvidence } from "./update-evidence.js";
import { deliverSessionEvent } from "./session-event-delivery.js";
import { join } from "node:path";
import {
  cancelPendingFor,
  createTerminal,
  killTerminal,
  listTerminals,
  readTextFile,
  registerBrokers,
  releaseTerminal,
  requestElicitationForm,
  requestElicitationUrl,
  requestPermission,
  setBrokerSessionEventSink,
  terminalOutput,
  terminalSnapshot,
  waitForTerminalExit,
  writeTextFile,
} from "./brokers.js";
// Side-effect import: registers ipcMain handlers for the UI terminal
// (bottom-panel pty shells). Distinct from the ACP brokers above.
import "./ui-terminal-broker.js";
// Side-effect import: directory listing for the side-panel file tree.
import "./ui-fs-broker.js";
// Side-effect import: CDP-backed selection and screenshots for the
// in-app browser. Ownership checks keep callers scoped to their own webview.
import "./browser-element-picker-broker.js";
// Side-effect import: task-scoped Browser WebView registry and browser
// harness routing. Agent tools and the visible right rail share these guests.
import { browserWebviewTools } from "./browser-view-broker.js";
import { buildAcpMcpServers } from "./acp-mcp-injection.js";
import { McpAppRuntime } from "./mcp-app-runtime.js";
import { CodexPluginRuntime } from "./codex-plugin-runtime.js";
import { PluginSkillsMcpBridge } from "./plugin-skills-mcp.js";
import type { McpAppRequestInput, McpAppResolveInput } from "../shared/mcp-app.js";
import {
  readInlineVisualizationFile,
  watchInlineVisualizationFile,
} from "./inline-visualization-file.js";
import { registerSandboxDocument } from "./mcp-app-document-store.js";
// Side-effect import: current-tab browser data, downloads, screenshots and
// privacy controls. Each handler revalidates the guest ownership boundary.
import "./browser-data-broker.js";
import { ScheduleStore } from "./schedule-store.js";
import { ScheduleEngine } from "./schedule-engine.js";
import { ScheduledTaskExecutor } from "./scheduled-task-executor.js";
import { ScheduleService } from "./schedule-service.js";
import { ScheduleHarnessMcpBridge } from "./schedule-harness-mcp.js";
import { createBrowserPluginService } from "./browser-plugin-service.js";
import { createElectronInAppBrowserAdapter } from "./browser-plugin-inapp-adapter.js";
import {
  createChromeExtensionBrowserAdapter,
  type ChromeExtensionBridgeHealth,
} from "./browser-plugin-extension-adapter.js";
import { createChromeExtensionHttpBridge } from "./browser-extension-http-bridge.js";
import { registerBrowserPluginIpc } from "./browser-plugin-ipc.js";
import {
  createBrowserMcpHttpServer,
  createBrowserMcpServerConfig,
} from "./browser-plugin-mcp.js";
import { SessionHistoryMcpBridge } from "./session-history-mcp.js";
import { formatSessionHistory } from "./session-history-tool.js";

interface RegisterDeps {
  openmaAccount?: OpenmaAccount;
  /** Path used to cache the live ACP registry JSON. Phase 1 stub returns the
   *  overlay-only set; later phases pass `app.getPath('userData')/...` */
  registryCachePath: string;
  probeCachePath?: string;
  acpBinDir: string;
  acpInstallRoot: string;
  npmCommand?: string;
  npmCommandArgs?: string[];
  npmEnv?: NodeJS.ProcessEnv;
  npmRegistryUrls?: string[];
  scheduleDbPath: string;
  browserMcpServerForTask?: (taskId: string) => unknown;
  /** Codex-compatible plugin bundle roots. Defaults to ~/.oma/plugins. */
  pluginRoots?: readonly string[];
  /** Relay host output before filtering execution copies out of local UI. */
  sessionActivitySink?: (event: SessionEventOut) => void;
  sessionEventSink?: (event: SessionEventOut) => void;
  isRunnerSession?: (sessionId: string) => boolean;
  requestRunnerPermission?: (sessionId: string, params: unknown) => Promise<unknown>;
  cancelRunnerPending?: (sessionId: string) => void;
}

interface TestAgentSetupCall {
  type: "list" | "install" | "upgrade" | "uninstall" | "auth" | "logout";
  id?: string;
  methodId?: string;
  sessionId?: string;
}

interface TestAgentSetupFixture {
  agents: AgentInfo[];
  runtimeStatuses?: Record<string, SessionRuntimeStatus>;
  authenticateResults?: Record<string, AgentInfo[]>;
  logoutResults?: Record<string, AgentInfo[]>;
  installResults?: Record<string, AgentInfo[]>;
  upgradeResults?: Record<string, AgentInfo[]>;
  uninstallResults?: Record<string, AgentInfo[]>;
  calls?: TestAgentSetupCall[];
}

/**
 * Wire up IPC + return the singleton SessionManager. The manager's `Sender`
 * pushes events to every active BrowserWindow — works for the multi-window
 * case in Phase 9, and is a no-op when no window is open (renderer reload
 * picks up via `sessionAnnounce`).
 */
export interface RegisteredIpcRuntime {
  sessionManager: SessionManager;
  refreshPlugins(): void;
  dispose(): Promise<void>;
}

function withProjectDirectories(session: PersistedSession): PersistedSessionInfo {
  const project = session.project_id ? getProject(session.project_id) : null;
  const additionalDirectories = session.additional_directories
    ?? (project
      ? project.source_folders.filter((folder) => folder !== session.cwd)
      : []);
  return {
    ...session,
    project_id: session.project_id ?? null,
    additional_directories: additionalDirectories,
  };
}

let openmaPromptQueue: {
  owns(sessionId: string): boolean;
  updatePromptQueue(command: SessionPromptQueueCommandParams): void;
} | null = null;

/** Cursor Cloud follow-ups reuse the desktop prompt queue. Registered after OpenMA tasks exist. */
export function attachOpenmaPromptQueue(queue: NonNullable<typeof openmaPromptQueue> | null): void {
  openmaPromptQueue = queue;
}

export async function registerIpc(deps: RegisterDeps): Promise<RegisteredIpcRuntime> {
  const isLocalSession = (id: string) => !deps.isRunnerSession?.(id);
  const assertLocalSession = (id: string): void => {
    if (!isLocalSession(id)) throw new Error("Use the associated OpenMA task to operate this runner session");
  };
  const handleLocalSession = <P extends { session_id: string }>(channel: string, listener: (event: IpcMainInvokeEvent, params: P) => unknown): void => {
    ipcMain.handle(channel, (event, params: P) => {
      assertLocalSession(params.session_id);
      return listener(event, params);
    });
  };
  const testHooksEnabled = process.env["BACKCHAT_TEST_HOOKS"] === "1";
  const testPromptCalls: SessionPromptParams[] = [];
  const testCommandCalls: SessionRunCommandParams[] = [];
  const testConfigOptionCalls: SessionSetConfigOptionParams[] = [];
  const scheduleStore = new ScheduleStore(deps.scheduleDbPath);
  let scheduleMcpBridge: ScheduleHarnessMcpBridge | null = null;
  let testAgentSetupFixture: TestAgentSetupFixture | null = null;
  const isSyntheticTestSession = (sessionId: string) =>
    sessionId.startsWith("e2e-") || sessionId.startsWith("sess-test-");
  const agentSetup = createAgentSetupService({
    registryCachePath: deps.registryCachePath,
    ...(deps.probeCachePath ? { probeCachePath: deps.probeCachePath } : {}),
    acpBinDir: deps.acpBinDir,
    acpInstallRoot: deps.acpInstallRoot,
    npmCommand: deps.npmCommand,
    npmCommandArgs: deps.npmCommandArgs,
    npmEnv: deps.npmEnv,
    npmRegistryUrls: deps.npmRegistryUrls,
    launchInteractiveAuth: launchTerminalAuth,
    agentOverrides: () => settingsStore.get().agents,
    getEnabledAgentIds: () => settingsStore.get().agents
      .filter((agent) => agent.enabled)
      .map((agent) => agent.id),
  });
  const pluginRuntime = new CodexPluginRuntime(
    deps.pluginRoots ?? [join(openmaRoot(), "plugins")],
  );
  const pluginCatalog = pluginRuntime.start();
  for (const error of pluginCatalog.errors) {
    process.stderr.write(`! Codex plugin skipped (${error.root}): ${error.message}\n`);
  }
  const pluginSkillsMcpBridge = new PluginSkillsMcpBridge(
    () => pluginRuntime.skills(),
  );
  await pluginSkillsMcpBridge.start();
  const sessionHistoryMcpBridge = new SessionHistoryMcpBridge({
    list: async (taskId, input) => {
      const query = input.query?.trim().toLocaleLowerCase() ?? "";
      const limit = Math.min(100, Math.max(1, input.limit ?? 20));
      const sessions = listSessions(200)
        .filter((session) => session.id !== taskId)
        .filter((session) => {
          if (!query) return true;
          return [session.title, session.id, session.agent_id].some((value) =>
            value.toLocaleLowerCase().includes(query),
          );
        })
        .slice(0, limit)
        .map((session) => ({
          id: session.id,
          title: session.title || session.id,
          agent_id: session.agent_id,
          last_used_at: session.last_used_at,
        }));
      return { sessions };
    },
    read: async (taskId, input) => {
      if (input.session_id === taskId) {
        throw new Error("Use the current conversation context instead of reading the current session");
      }
      const session = getSession(input.session_id);
      if (!session) throw new Error(`Unknown OpenMA session: ${input.session_id}`);
      return formatSessionHistory(
        {
          id: session.id,
          title: session.title || session.id,
          agent_id: session.agent_id,
          cwd: session.cwd,
        },
        loadHistory(session.id),
        input,
      );
    },
  });
  await sessionHistoryMcpBridge.start();
  const allConfiguredMcpServers = (): SettingsMcpServer[] =>
    pluginRuntime.withConfiguredMcpServers(settingsStore.get().mcp_servers);
  const allAgentMcpServers = (): SettingsMcpServer[] => [
    ...allConfiguredMcpServers(),
    pluginSkillsMcpBridge.descriptor(),
  ];
  const mcpAppRuntime = new McpAppRuntime(allConfiguredMcpServers);
  const inlineVisualizationWatches = new Map<
    string,
    { ownerId: number; close: () => void }
  >();
  const closeInlineVisualizationWatch = (watchId: string, ownerId?: number): void => {
    const watch = inlineVisualizationWatches.get(watchId);
    if (!watch || (ownerId !== undefined && watch.ownerId !== ownerId)) return;
    watch.close();
    inlineVisualizationWatches.delete(watchId);
  };
  const agentWarmupStartedAt = performance.now();
  const agentWarmup =
    testHooksEnabled && process.env["BACKCHAT_E2E_SKIP_AGENT_WARMUP"] === "1"
      ? Promise.resolve()
      : agentSetup.warmup().then(() => {
          logAppEvent("app.agent_warmup", { outcome: "ready", duration_ms: Math.round(performance.now() - agentWarmupStartedAt) });
        }).catch((error) => {
          logAppEvent("app.agent_warmup", { outcome: "error", duration_ms: Math.round(performance.now() - agentWarmupStartedAt), message: error instanceof Error ? error.message : String(error) });
          process.stderr.write(`! ACP agent warmup failed: ${error instanceof Error ? error.message : String(error)}\n`);
        });
  const requestedChromeExtensionBridgePort = Number(
    process.env["BACKCHAT_BROWSER_EXTENSION_PORT"] ?? "29174",
  );
  const preferredChromeExtensionBridgePort = Number.isFinite(
    requestedChromeExtensionBridgePort,
  )
    ? requestedChromeExtensionBridgePort
    : 29174;
  const chromeExtensionBridge = await createChromeExtensionHttpBridge({
    preferredPort: preferredChromeExtensionBridgePort,
  }).catch((error) => {
    process.stderr.write(
      `! Chrome extension bridge failed to start: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return null;
  });
  const chromeExtensionBridgeMetadataPort = chromeExtensionBridge
    ? new URL(chromeExtensionBridge.url).port
    : String(preferredChromeExtensionBridgePort);
  const browserPluginService = createBrowserPluginService({
    adapters: [
      createElectronInAppBrowserAdapter(),
      createChromeExtensionBrowserAdapter({
        metadata: () => chromeExtensionBridgeMetadata(
          chromeExtensionBridgeMetadataPort,
          chromeExtensionBridge?.bridge.health,
        ),
        bridge: {
          get registration() {
            return chromeExtensionBridge?.bridge.registration ?? null;
          },
          async sendCommand(command) {
            if (!chromeExtensionBridge) {
              throw new Error("Chrome extension bridge is not available");
            }
            return chromeExtensionBridge.bridge.sendCommand(command);
          },
        },
      }),
    ],
  });
  registerBrowserPluginIpc(ipcMain, browserPluginService);
  const stopBrowserPluginState = browserPluginService.onEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(PushChannel.BrowserState, event);
      }
    }
  });
  const browserMcpHttpServer = await createBrowserMcpHttpServer({
    service: browserPluginService,
  }).catch((error) => {
    process.stderr.write(
      `! Browser MCP server failed to start: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return null;
  });
  const browserPluginMcpServer: SettingsMcpServer | undefined = browserMcpHttpServer
    ? {
        id: "backchat-browser-plugin",
        ...createBrowserMcpServerConfig({
          url: browserMcpHttpServer.url,
          token: browserMcpHttpServer.token,
        }),
      }
    : undefined;
  const recordTestAgentSetupCall = (call: TestAgentSetupCall): void => {
    testAgentSetupFixture?.calls?.push(call);
  };
  const testAgentSetupResult = (
    bucket: keyof Pick<
      TestAgentSetupFixture,
      "authenticateResults" | "logoutResults" | "installResults" | "upgradeResults" | "uninstallResults"
    >,
    id: string,
  ): AgentInfo[] => {
    if (!testAgentSetupFixture) return [];
    const next = testAgentSetupFixture[bucket]?.[id] ?? testAgentSetupFixture.agents;
    testAgentSetupFixture.agents = next;
    return next;
  };

  // Two outbound sinks: single-session events and pair events. Both
  // ultimately broadcast to all browser windows, just on distinct
  // channels so the renderer can wire them to independent reducers.
  const enrichSessionEvent = createSessionEventEnricher(
    () => new Date().toISOString(),
    (sessionId) => latestPersistedOpenMAEventSequence(loadHistory(sessionId)),
  );
  const publishSingle = (enriched: SessionEventOut) => {
    deps.sessionEventSink?.(enriched);
    // The observer task is the UI identity. This persisted association applies
    // even when the account is logged out or this runner connection is stopped.
    if (!isLocalSession(enriched.session_id)) return;
    forwardSessionEventToPet(enriched);
    if (enriched.type !== "session.event") {
      process.stdout.write(`[session] ${enriched.type} sid=${enriched.session_id.slice(0, 8)}\n`);
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(PushChannel.SessionEvent, enriched);
    }
  };
  const persistCanonicalSessionEvent = (
    event: NonNullable<SessionEventOut["openma_event"]>,
  ): void => appendEvent(event.session_id, "openma_event", event);
  const logSessionPersistError = (
    error: unknown,
    event: NonNullable<SessionEventOut["openma_event"]>,
  ): void => {
      logAppEvent("session.event.persist_error", {
        session_id: event.session_id,
        event_id: event.event_id,
        event_type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
  };
  setBrokerSessionEventSink((msg) => {
    const enriched = enrichSessionEvent(msg);
    if (enriched.openma_event) projectAgents?.observe(enriched.openma_event as ProjectAgentEvent);
    deliverSessionEvent(enriched, {
      publish: publishSingle,
      persist: persistCanonicalSessionEvent,
      onPersistError: logSessionPersistError,
    });
  });
  const pairSink = (msg: PairEventOut) => {
    if (msg.type !== "pair.event") {
      process.stdout.write(`[pair] ${msg.type} pid=${msg.pair_id.slice(0, 8)}\n`);
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(PushChannel.PairEvent, msg);
    }
  };

  // Forward declaration — pairManager is constructed AFTER sessionManager
  // (it takes sessionManager as a dep), but the SessionManager's send tee
  // closes over `pairManager` so we need a mutable holder. The tee is
  // safe to call before pairManager exists: it just falls through to the
  // single sink, which is the correct behavior for the boot window
  // before any pair is registered.
  let pairManager: PairManager | null = null;
  let projectAgents: ProjectAgentBridge | undefined;
  let projectMcp: ProjectMcpBridge | undefined;
  const send = (msg: SessionEventOut) => {
    for (const event of streamEventsFromSession(msg)) publishControlLiveEvent(event);
    deps.sessionActivitySink?.(msg);
    const enriched = enrichSessionEvent(msg);
    if (enriched.openma_event) projectAgents?.observe(enriched.openma_event as ProjectAgentEvent);
    deliverSessionEvent(enriched, {
      publish: (message) => {
        const routed = pairManager?.routeOrPassthrough(message) ?? false;
        if (!routed) publishSingle(message);
      },
      persist: persistCanonicalSessionEvent,
      onPersistError: logSessionPersistError,
    });
  };
  const resolveInstalledAgentVersion = async (
    agentId: string,
  ): Promise<string | undefined> => {
    const agents = testAgentSetupFixture?.agents ?? await agentSetup.listAgents();
    return agents.find((agent) => agent.id === agentId)?.installedVersion;
  };

  const sessionManager = new SessionManager({
    send,
    acpBinDir: deps.acpBinDir,
    acpInstallRoot: deps.acpInstallRoot,
    // MCP servers come from settings now — Phase 8 finishes the per-agent
    // override matrix; for now we pass every configured server through to
    // every spawn. ACP McpServer shape matches our SettingsMcpServer.
    resolveMcpServers: (_agentId, taskId) => buildAcpMcpServers(
      allAgentMcpServers(),
      [
        deps.browserMcpServerForTask?.(taskId) as SettingsMcpServer | undefined,
        browserPluginMcpServer,
        scheduleMcpBridge?.descriptor(taskId),
        projectMcp?.descriptor(taskId),
        sessionHistoryMcpBridge.descriptor(taskId),
      ].filter((server): server is SettingsMcpServer => !!server),
    ),
    resolveDefaults: () => {
      const s = settingsStore.get();
      return {
        permissionMode: s.default.permission_mode,
        promptQueueEnabled: s.default.prompt_queue_enabled,
      };
    },
    resolveAgentOverride: (agentId) => {
      const o = settingsStore.get().agents.find((a) => a.id === agentId);
      if (!o) return undefined;
      // Convert the {name,value}[] pairs back to the Record<string,string>
      // shape NodeSpawner consumes. Empty values pass through; users may
      // intentionally set a var to "" to clear an inherited value.
      const envOverride: Record<string, string> = {};
      for (const e of o.env) envOverride[e.name] = e.value;
      return {
        labelOverride: o.label_override,
        commandOverride: o.command_override,
        argsOverride: o.args_override,
        envOverride,
      };
    },
    resolveInstalledAgentVersion,
    observeAuth: (agentId, observation) => agentSetup.observeAuth(agentId, observation),
    observeSessionConfig: (agentId, snapshot) => agentSetup.observeSessionConfig(agentId, snapshot),
    // Phase 6: permission / fs / terminal brokers — wired so the agent
    // can actually read files, write files, run commands. Defaults are no
    // longer "deny" — they go to a renderer modal (permission, out-of-cwd
    // writes) or straight to child_process (terminal).
    //
    // The brokers accept/return `unknown` shapes that match ACP's
    // request/response schema at runtime; the vendored acp package's
    // ClientCallbacks type narrows on the SDK types. We trust the
    // brokers to follow the schema (smoke-tested against claude-acp).
    buildCallbacks: (sessionId, sessionCwd, additionalDirectories, agentId) => ({
      requestPermission: (params) =>
        (isLocalSession(sessionId)
          ? requestPermission(sessionId, params, agentId)
          : deps.requestRunnerPermission?.(sessionId, params) ?? Promise.resolve({ outcome: { outcome: "cancelled" } })) as never,
      readTextFile: (params) => readTextFile(params) as never,
      writeTextFile: (params) =>
        writeTextFile(
          sessionId,
          [sessionCwd, ...additionalDirectories],
          params,
        ) as never,
      createTerminal: async (params) =>
        createTerminal(sessionId, sessionCwd, params) as never,
      terminalOutput: async (params) => terminalOutput(params) as never,
      releaseTerminal: async (params) => releaseTerminal(params) as never,
      waitForTerminalExit: (params) =>
        waitForTerminalExit(params) as never,
      killTerminal: async (params) => killTerminal(params) as never,
    }),
    requestElicitationForm: (request) =>
      requestElicitationForm(request.sessionId, request),
    requestElicitationUrl: (request) =>
      requestElicitationUrl(request.sessionId, request),
  });
  sessionManager.setOnSessionPendingWorkCancelled((id) => { deps.cancelRunnerPending?.(id); cancelPendingFor(id); });

  // Pair manager — sibling of sessionManager. Holds a reference and
  // calls its 1:1 API; the tee installed above routes pair-owned
  // session events into PairManager's reshape path.
  pairManager = new PairManager({ sessionManager, pairSink });

  const projectWork = new ProjectWorkService({
    directory: join(openmaRoot(), "backchat", "projects"),
    getProject,
    driver: (agentId, project, role, config) => projectAgents!.driver(agentId, project, role, config),
  });
  projectAgents = new ProjectAgentBridge(projectWork.db, {
    start: p => sessionManager.start(p), prompt: p => sessionManager.prompt(p),
    cancel: (id, turn) => sessionManager.cancel(id, turn),
    dispose: id => sessionManager.dispose(id), findSession: getSession,
  });
  projectMcp = new ProjectMcpBridge(projectWork, projectAgents);
  await projectMcp.start();
  projectWork.start();
  const projectRouter = new ProjectCloudRouter(projectWork, scope => { if(!deps.openmaAccount) throw new Error("OpenMA login required"); return deps.openmaAccount.connection(scope); }, getProject, process.env.BACKCHAT_PROJECT_WORKER_URL);
  ipcMain.handle(InvokeChannel.ProjectWorkView, async (_e, id: string) =>
    withExternalWork(id, await projectRouter.view(id)));
  ipcMain.handle(InvokeChannel.ExternalCoordinatorsList, () => ({
    coordinators: listExternalCoordinators(),
    tasks: listExternalTasks(),
  }));
  ipcMain.handle(InvokeChannel.ExternalCoordinatorCreate, (_e, input: { project_id: string; name: string }) => {
    if (!input?.project_id?.trim() || !input?.name?.trim()) {
      throw new Error("Project id and name are required");
    }
    if (!getProject(input.project_id.trim())) throw new Error("Project not found");
    return ensureExternalCoordinator(input.project_id.trim(), input.name);
  });
  ipcMain.handle(InvokeChannel.ExternalCoordinatorRemove, async (_e, input: { id: string; delete_threads?: boolean }) => {
    const coordinator = getExternalCoordinator(input?.id ?? "");
    if (!coordinator) throw new Error("External coordinator not found");
    if (input.delete_threads) {
      for (const session of listSessionsForExternalCoordinator(coordinator)) {
        try {
          await sessionManager.dispose(session.id);
        } catch {
          // Already stopped.
        }
      }
    }
    return removeExternalCoordinator(coordinator.id, input.delete_threads === true);
  });
  ipcMain.handle(InvokeChannel.ProjectWorkSave, (_e, config) => projectRouter.save(config));
  ipcMain.handle(InvokeChannel.ProjectWorkSubmit, (_e, input) => projectRouter.submit(input));
  ipcMain.handle(InvokeChannel.ProjectWorkGoal, (_e, input) => projectRouter.goal(input));

  const scheduledTaskExecutor = new ScheduledTaskExecutor({
    start: (input) => sessionManager.start(input),
    prompt: (input) => sessionManager.prompt(input),
    findSession: (sessionId) => getSession(sessionId),
  });
  const scheduleEngine = new ScheduleEngine({
    store: scheduleStore,
    execute: (schedule) => scheduledTaskExecutor.execute(schedule),
    notify: ({ title, body, sessionId }) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      notification.on("click", () => {
        const path = sessionId
          ? `/chat/${encodeURIComponent(sessionId)}`
          : "/scheduled";
        const window = BrowserWindow.getFocusedWindow()
          ?? BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
        window?.webContents.send(PushChannel.MenuNavigate, path);
        window?.show();
        window?.focus();
      });
      notification.show();
    },
  });
  const scheduleService = new ScheduleService({
    store: scheduleStore,
    findSession: (taskId) => getSession(taskId),
    reschedule: () => scheduleEngine.reschedule(),
  });
  scheduleMcpBridge = new ScheduleHarnessMcpBridge(scheduleService);
  await scheduleMcpBridge.start();
  scheduleEngine.start();

  ipcMain.handle(InvokeChannel.Ping, (_e, msg: string) => {
    const reply = `pong: ${msg}`;
    process.stdout.write(`[ipc-ping] ${reply}\n`);
    return reply;
  });

  ipcMain.handle(
    InvokeChannel.AcpTerminalsList,
    (_e, p: { sessionId: string }) => listTerminals(p.sessionId),
  );
  ipcMain.handle(
    InvokeChannel.AcpTerminalSnapshot,
    (_e, p: { terminalId: string }) => terminalSnapshot(p.terminalId),
  );
  ipcMain.handle(
    InvokeChannel.AcpTerminalKill,
    (_e, p: { terminalId: string }) => killTerminal(p),
  );

  ipcMain.handle(
    InvokeChannel.AgentsList,
    async (_e, options?: AgentListOptions): Promise<AgentInfo[]> => {
      if (testAgentSetupFixture) {
        recordTestAgentSetupCall({ type: "list" });
        return testAgentSetupFixture.agents;
      }
      if (options?.readiness === "snapshot" && !options.refresh) {
        return agentSetup.listAgents();
      }
      await agentWarmup;
      return options?.refresh
        ? agentSetup.refreshEnabledAgents()
        : agentSetup.listAgents();
    },
  );
  ipcMain.handle(InvokeChannel.AgentInstall, (_e, id: string): Promise<AgentInfo[]> | AgentInfo[] => {
    if (testAgentSetupFixture) {
      recordTestAgentSetupCall({ type: "install", id });
      return testAgentSetupResult("installResults", id);
    }
    return agentSetup.installAgent(id);
  });
  ipcMain.handle(InvokeChannel.AgentUpgrade, (_e, id: string): Promise<AgentInfo[]> | AgentInfo[] => {
    if (testAgentSetupFixture) {
      recordTestAgentSetupCall({ type: "upgrade", id });
      return testAgentSetupResult("upgradeResults", id);
    }
    return agentSetup.upgradeAgent(id);
  });
  ipcMain.handle(InvokeChannel.AgentUninstall, (_e, id: string): Promise<AgentInfo[]> | AgentInfo[] => {
    if (testAgentSetupFixture) {
      recordTestAgentSetupCall({ type: "uninstall", id });
      return testAgentSetupResult("uninstallResults", id);
    }
    return agentSetup.uninstallAgent(id);
  });
  ipcMain.handle(
    InvokeChannel.AgentAuthenticate,
    (_e, p: {
      id: string;
      methodId?: string;
      secret?: string;
      values?: Record<string, string>;
      gateway?: { baseUrl: string; headers?: Record<string, string>; providerName?: string };
    }): Promise<AgentInfo[]> | AgentInfo[] => {
      if (testAgentSetupFixture) {
        recordTestAgentSetupCall({ type: "auth", id: p.id, methodId: p.methodId });
        return testAgentSetupResult("authenticateResults", p.id);
      }
      return agentSetup.authenticateAgent(p.id, {
        methodId: p.methodId,
        ...(p.secret ? { secret: p.secret } : {}),
        ...(p.values ? { values: p.values } : {}),
        ...(p.gateway ? { gateway: p.gateway } : {}),
      });
    },
  );
  ipcMain.handle(
    InvokeChannel.AgentLogout,
    async (_e, p: { id: string; sessionId?: string }): Promise<AgentInfo[]> => {
      if (testAgentSetupFixture) {
        recordTestAgentSetupCall({ type: "logout", id: p.id, sessionId: p.sessionId });
        const agent = testAgentSetupFixture.agents.find((item) => item.id === p.id);
        if (agent?.auth?.supportsLogout !== true) {
          throw new Error("This agent does not support ACP logout.");
        }
        return testAgentSetupResult("logoutResults", p.id);
      }
      if (p.sessionId && await sessionManager.logout(p.sessionId)) {
        return agentSetup.listAgents();
      }
      return agentSetup.logoutAgent(p.id);
    },
  );
  handleLocalSession(InvokeChannel.SessionStart, (_e, p: SessionStartParams) => {
    if (testHooksEnabled && isSyntheticTestSession(p.session_id)) {
      const result = {
        status: "ready" as const,
        session_id: p.session_id,
        acp_session_id: p.resume?.acp_session_id ?? `acp-${p.session_id}`,
        agent_id: p.agent_id,
        cwd: p.cwd ?? "/tmp/backchat-test",
        additional_directories: p.additional_directories,
        project_id: p.project_id,
      };
      send({
        type: "session.ready",
        session_id: result.session_id,
        acp_session_id: result.acp_session_id,
        agent_id: result.agent_id,
        cwd: result.cwd,
        additional_directories: result.additional_directories,
        project_id: result.project_id,
        workspace_id: null,
      });
      return result;
    }
    return sessionManager.start(p);
  });
  handleLocalSession(InvokeChannel.SessionPrompt, (_e, p: SessionPromptParams) => {
    if (testHooksEnabled && isSyntheticTestSession(p.session_id)) {
      testPromptCalls.push(p);
      send({
        type: "session.complete",
        session_id: p.session_id,
        turn_id: p.turn_id,
      });
      return;
    }
    return sessionManager.prompt(p);
  });
  handleLocalSession(
    InvokeChannel.SessionUpdatePromptQueue,
    (_e, p: SessionPromptQueueCommandParams) => {
      if (openmaPromptQueue?.owns(p.session_id)) return openmaPromptQueue.updatePromptQueue(p);
      return sessionManager.updatePromptQueue(p);
    },
  );
  handleLocalSession(
    InvokeChannel.SessionRunCommand,
    (_e, p: SessionRunCommandParams) => {
      if (testHooksEnabled && isSyntheticTestSession(p.session_id)) {
        testCommandCalls.push(p);
        return;
      }
      return sessionManager.runCommand(p);
    },
  );
  handleLocalSession(
    InvokeChannel.SessionSetConfigOption,
    (_e, p: SessionSetConfigOptionParams) => {
      if (testHooksEnabled && isSyntheticTestSession(p.session_id)) {
        testConfigOptionCalls.push(p);
        send({
          type: "session.event",
          session_id: p.session_id,
          turn_id: "dummy",
          event: {
            sessionUpdate: "config_option_update",
            configOptions: [
              {
                id: p.config_id,
                name: "Model",
                category: "model",
                type: "select",
                currentValue: String(p.value),
                options: [
                  { value: "gpt-5-mini", name: "GPT-5 mini" },
                  { value: "gpt-5", name: "GPT-5" },
                ],
              },
            ],
          },
        });
        return;
      }
      return sessionManager.setConfigOption(p);
    },
  );
  handleLocalSession(
    InvokeChannel.SessionRequestExtension,
    (_e, p: SessionRequestExtensionParams) =>
      sessionManager.requestExtension(p),
  );
  handleLocalSession(
    InvokeChannel.SessionCancel,
    (_e, p: { session_id: string; turn_id: string }) =>
      sessionManager.cancel(p.session_id, p.turn_id),
  );
  handleLocalSession(
    InvokeChannel.SessionClose,
    (_e, p: { session_id: string }) =>
      sessionManager.close(p.session_id),
  );
  handleLocalSession(
    InvokeChannel.SessionDispose,
    (_e, p: { session_id: string; remove_cwd?: boolean }) =>
      sessionManager.dispose(p.session_id, { removeCwd: p.remove_cwd }),
  );
  handleLocalSession(
    InvokeChannel.SessionRuntimeStatus,
    (_e, p: { session_id: string }) => {
      const fixtureStatus = testAgentSetupFixture?.runtimeStatuses?.[p.session_id];
      if (testHooksEnabled && fixtureStatus) return fixtureStatus;
      return sessionManager.getRuntimeStatus(p.session_id);
    },
  );
  handleLocalSession(
    InvokeChannel.SessionRestart,
    (
      _e,
      p: { session_id: string; mode: "now" | "after-turn" },
    ): Promise<SessionRestartResult> | SessionRestartResult => {
      const fixtureStatus = testAgentSetupFixture?.runtimeStatuses?.[p.session_id];
      if (testHooksEnabled && fixtureStatus) {
        if (p.mode === "after-turn" && fixtureStatus.busy) {
          fixtureStatus.restart_pending = true;
          send({ type: "session.restart_pending", session_id: p.session_id });
          return { session_id: p.session_id, status: "pending" };
        }
        fixtureStatus.running_version = fixtureStatus.installed_version;
        fixtureStatus.restart_required = false;
        fixtureStatus.restart_pending = false;
        fixtureStatus.busy = false;
        send({ type: "session.restarted", session_id: p.session_id });
        return { session_id: p.session_id, status: "restarted" };
      }
      return sessionManager.restartSession(p.session_id, { mode: p.mode });
    },
  );
  ipcMain.handle(InvokeChannel.SessionAnnounce, () => {
    sessionManager.announceAll();
    pairManager?.announcePairs();
  });

  ipcMain.handle(InvokeChannel.PairStart, (_e, p: PairStartParams) =>
    pairManager!.startPair(p),
  );
  ipcMain.handle(InvokeChannel.PairPrompt, (_e, p: PairPromptParams) =>
    pairManager!.promptPair(p),
  );
  ipcMain.handle(
    InvokeChannel.PairCancel,
    (_e, p: { pair_id: string; turn_id: string }) =>
      pairManager!.cancelPair(p.pair_id, p.turn_id),
  );
  ipcMain.handle(InvokeChannel.PairDispose, (_e, p: { pair_id: string }) =>
    pairManager!.disposePair(p.pair_id),
  );
  ipcMain.handle(
    InvokeChannel.PairReleaseMember,
    (_e, p: { pair_id: string; session_id: string }) =>
      pairManager!.releaseMember(p.pair_id, p.session_id),
  );
  ipcMain.handle(InvokeChannel.PairsList, (): PersistedPairInfo[] =>
    listPairGroups().map((pair) => ({
      id: pair.id,
      title: pair.title,
      workspace_cwd: pair.workspace_cwd,
      last_used_at: pair.last_used_at,
      created_at: pair.created_at,
      archived_at: pair.archived_at,
      pinned_at: pair.pinned_at,
      members: pair.members.map((member) => ({
        id: member.id,
        agent_id: member.agent_id,
        cwd: member.cwd,
        acp_session_id: member.acp_session_id,
        title: member.title,
        title_manually_set: member.title_manually_set,
        last_used_at: member.last_used_at,
        created_at: member.created_at,
        archived_at: member.archived_at,
        pinned_at: member.pinned_at,
        project_id: member.project_id ?? null,
        additional_directories: [],
        workspace_id: null,
        parent_session_id: member.parent_session_id ?? null,
        fork_kind: member.fork_kind ?? null,
      })),
    })),
  );
  ipcMain.handle(InvokeChannel.PairSave, (_e, p: PairSaveParams) =>
    savePairGroup({
      id: p.pair_id,
      title: p.title,
      workspace_cwd: p.workspace_cwd,
      members: p.members.map((member) => ({
        id: member.session_id,
        agent_id: member.agent_id,
        cwd: member.cwd,
      })),
    }),
  );
  ipcMain.handle(InvokeChannel.PairsPin, (_e, p: { pair_id: string }) =>
    pinPairSession(p.pair_id));
  ipcMain.handle(InvokeChannel.PairsUnpin, (_e, p: { pair_id: string }) =>
    unpinPairSession(p.pair_id));
  ipcMain.handle(InvokeChannel.PairsArchive, (_e, p: { pair_id: string }) =>
    archivePairSession(p.pair_id));
  ipcMain.handle(InvokeChannel.PairsUnarchive, (_e, p: { pair_id: string }) =>
    unarchivePairSession(p.pair_id));

  ipcMain.handle(InvokeChannel.ProjectsList, (): ProjectInfo[] => listProjects());
  ipcMain.handle(
    InvokeChannel.ProjectSave,
    (_e, p: ProjectSaveParams): ProjectInfo => saveProjectCommand({
      project_id: p.project_id,
      name: p.name,
      source_folders: p.source_folders,
      primary_folder: p.primary_folder,
      requireId: true,
    }),
  );
  ipcMain.handle(
    InvokeChannel.ProjectDelete,
    async (_e, p: { project_id: string }): Promise<void> => {
      const listed = await workspaceService.list(p.project_id);
      await disposeProjectSessions(sessionManager, p.project_id, listed.map((workspace) => workspace.id));
      await projectRouter.remove(p.project_id);
      deleteProject(p.project_id);
    },
  );
  ipcMain.handle(
    InvokeChannel.WorkspacesList,
    (_e, p?: { project_id?: string; source_directory?: string }): Promise<WorkspaceInfo[]> =>
      workspaceService.list(p?.project_id?.trim() || undefined, p?.source_directory),
  );
  ipcMain.handle(
    InvokeChannel.WorkspaceCreate,
    (_e, p: WorkspaceCreateParams): Promise<WorkspaceInfo> => {
      return workspaceService.create({
        project_id: p.project_id?.trim() || null,
        name: p.name,
        checkouts: p.checkouts,
        source_directories: !p.project_id && p.source_directory ? [p.source_directory] : undefined,
      });
    },
  );
  ipcMain.handle(
    InvokeChannel.WorkspaceDelete,
    (_e, p: { workspace_id: string }): Promise<void> => {
      return removeWorkspaceStoppingSessions(workspaceService, sessionManager, p.workspace_id).then(() => undefined);
    },
  );
  // Checkout sets created per session before workspaces existed become
  // workspaces of their own; nothing on disk moves.
  let controlServer: ControlServer | null = null;
  if (process.env["BACKCHAT_DISABLE_CONTROL"] !== "1") {
    const socketPath = controlSocketPath();
    try {
      controlServer = await startControlServer({
        socketPath,
        api: createControlApi({
          sessions: sessionManager,
          onProjectsChanged: () => {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) window.webContents.send(PushChannel.ProjectsChanged, {});
            }
          },
          work: {
            submit: (input) => projectRouter.submit(input),
            view: async (id) => withExternalWork(id, await projectRouter.view(id)),
            goal: (input) => projectRouter.goal(input),
          },
        }),
      });
    } catch (error) {
      console.warn("[control] failed to start; the GUI will keep running", error);
    }
    if (controlServer && process.env["BACKCHAT_TEST_HOOKS"] !== "1") {
      const scriptPath = app.isPackaged
        ? join(process.resourcesPath, "cli", "backchat.mjs")
        : join(app.getAppPath(), "src", "cli", "backchat.mjs");
      void installBackchatCli({ scriptPath }).then((installed) => {
        process.stdout.write(`[control] ${installed.detail} socket=${socketPath}\n`);
      }).catch((error: unknown) => {
        console.warn("[control] CLI install failed", error);
      });
    }
  }

  void workspaceService.migrateLegacy().then(({ adopted, removed }) => {
    if (adopted || removed) {
      process.stdout.write(`[workspaces] migrated legacy worktrees adopted=${adopted} removed=${removed}\n`);
    }
  }).catch((error: unknown) => {
    console.warn("[workspaces] legacy worktree migration failed", error);
  });

  ipcMain.handle(InvokeChannel.SessionsList, (_e, limit?: number):
    PersistedSessionInfo[] => listSessions(limit).filter((s) => isLocalSession(s.id)).map(withProjectDirectories));
  handleLocalSession(
    InvokeChannel.SessionsRename,
    (_e, p: { session_id: string; title: string }): void => {
      if (!p.session_id.trim()) throw new Error("Session id is required");
      renameSession(p.session_id, p.title);
    },
  );
  handleLocalSession(InvokeChannel.SessionsPin, (_e, p: { session_id: string }) =>
    pinSession(p.session_id));
  handleLocalSession(InvokeChannel.SessionsUnpin, (_e, p: { session_id: string }) =>
    unpinSession(p.session_id));
  handleLocalSession(InvokeChannel.SessionsArchive, (_e, p: { session_id: string }) => {
    scheduleStore.deleteBySourceSession(p.session_id);
    scheduleEngine.reschedule();
    archiveSession(p.session_id);
  });
  handleLocalSession(InvokeChannel.SessionsUnarchive, (_e, p: { session_id: string }) =>
    unarchiveSession(p.session_id));
  ipcMain.handle(
    InvokeChannel.SessionsListArchived,
    () => listArchivedSessions().filter((s) => isLocalSession(s.id)).map(withProjectDirectories),
  );
  // Hard delete: drop the SQL row (events cascade) AND the on-disk
  // session dir. Order matters — wipe the dir first so a partial
  // failure leaves the row to retry from; if we deleted the row
  // first and the rm threw, the file would be orphaned and harder
  // to find later. Dispose the ACP child too if it's still running
  // (e.g. user is deleting an archived session that was somehow
  // resumed in the background).
  handleLocalSession(
    InvokeChannel.SessionsDelete,
    async (_e, p: { session_id: string }) => {
      try {
        // removeCwd:true here would also be fine, but we always call
        // removeSessionCwd below anyway, so let dispose just tear
        // down the ACP child and leave file cleanup to one place.
        await sessionManager.dispose(p.session_id);
      } catch {
        /* not running — fine */
      }
      try {
        await removeSessionCwd(p.session_id);
      } catch {
        /* dir might be gone already — fine */
      }
      // Workspaces outlive sessions: a shared checkout set is deleted only
      // through workspaceDelete, never as a side effect of removing a chat.
      scheduleStore.deleteBySourceSession(p.session_id);
      scheduleEngine.reschedule();
      deleteSession(p.session_id);
    },
  );
  ipcMain.handle(
    InvokeChannel.SessionsLoadHistory,
    (_e, sessionId: string, page?: SessionHistoryPage): PersistedEventInfo[] => {
      assertLocalSession(sessionId);
      return loadHistoryPage(sessionId, {
        before_seq: typeof page?.before_seq === "number" ? page.before_seq : undefined,
        limit: typeof page?.limit === "number" ? page.limit : undefined,
      });
    },
  );
  handleLocalSession(
    InvokeChannel.SessionPersistCanonicalEvent,
    (_e, event: OpenMAEvent): void => {
      if (
        !event
        || !hasOpenMAEventSchema(event)
        || typeof event.event_id !== "string"
        || typeof event.session_id !== "string"
        || typeof event.type !== "string"
      ) {
        throw new Error("invalid OpenMA canonical event");
      }
      appendEvent(event.session_id, "openma_event", event);
    },
  );
  ipcMain.handle(
    InvokeChannel.SideWorkspacesList,
    (): PersistedSideWorkspaceInfo[] => listSideWorkspaces(),
  );
  ipcMain.handle(
    InvokeChannel.SideWorkspaceSave,
    (_e, p: SideWorkspaceSaveParams) => saveSideWorkspace(p),
  );
  ipcMain.handle(
    InvokeChannel.SideWorkspaceDelete,
    (_e, p: { task_id: string }) => deleteSideWorkspace(p.task_id),
  );
  ipcMain.handle(
    InvokeChannel.SessionsSearch,
    (_e, query: string, limit?: number) => searchMessages(query, limit).filter((hit) => isLocalSession(hit.session_id)),
  );
  ipcMain.handle(InvokeChannel.ActivityStats, async () => {
    await agentWarmup;
    return enrichActivityStats(getActivityStats(), getKnownAgents());
  });
  ipcMain.handle(InvokeChannel.SchedulesList, () => scheduleStore.list());
  ipcMain.handle(
    InvokeChannel.SchedulesCreate,
    (_e, input: CreateScheduleInput) => {
      const source = getSession(input.sourceSessionId);
      if (!source) throw new Error(`Cannot schedule unknown task: ${input.sourceSessionId}`);
      const created = scheduleStore.create({
        ...input,
        agentId: source.agent_id,
        cwd: source.cwd,
      });
      scheduleEngine.reschedule();
      return created;
    },
  );
  ipcMain.handle(
    InvokeChannel.SchedulesUpdate,
    (_e, input: UpdateScheduleInput) => {
      const updated = scheduleStore.update(input);
      scheduleEngine.reschedule();
      return updated;
    },
  );
  ipcMain.handle(InvokeChannel.SchedulesDelete, (_e, input: { id: string }) => {
    scheduleStore.delete(input.id);
    scheduleEngine.reschedule();
  });
  ipcMain.handle(
    InvokeChannel.ScheduleRunsList,
    (_e, input: { schedule_id: string }) => scheduleStore.listRuns(input.schedule_id),
  );

  // ---- Settings ----
  ipcMain.handle(InvokeChannel.SettingsGet, (): Settings => settingsStore.get());
  ipcMain.handle(
    InvokeChannel.SettingsPatch,
    (_e, partial: Partial<Settings>) => settingsStore.patch(partial),
  );
  ipcMain.handle(
    InvokeChannel.McpAppResolve,
    (_e, input: McpAppResolveInput) => mcpAppRuntime.resolve(input),
  );
  ipcMain.handle(
    InvokeChannel.McpAppRequest,
    (_e, input: McpAppRequestInput) => mcpAppRuntime.request(input),
  );
  ipcMain.handle(
    InvokeChannel.InlineVisualizationRead,
    (_e, input: { cwd: string; file: string }) => readInlineVisualizationFile(input),
  );
  ipcMain.handle(
    InvokeChannel.InlineVisualizationRegisterDocument,
    (_e, input: { html: string }) => {
      if (typeof input?.html !== "string") throw new Error("Visualization document is required");
      return { document_url: registerSandboxDocument(input.html) };
    },
  );
  ipcMain.handle(
    InvokeChannel.InlineVisualizationWatch,
    async (event, input: { cwd: string; file: string }) => {
      const watchId = randomUUID();
      const ownerId = event.sender.id;
      const close = await watchInlineVisualizationFile(input, () => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(PushChannel.InlineVisualizationChanged, { watch_id: watchId });
        }
      });
      inlineVisualizationWatches.set(watchId, { ownerId, close });
      event.sender.once("destroyed", () => closeInlineVisualizationWatch(watchId, ownerId));
      return { watch_id: watchId };
    },
  );
  ipcMain.handle(
    InvokeChannel.InlineVisualizationUnwatch,
    (event, input: { watch_id: string }) => {
      closeInlineVisualizationWatch(input.watch_id, event.sender.id);
    },
  );
  // Push every settings mutation out to all open windows. Subscribed once
  // at registration; never unsubscribed (the store lives for the process
  // lifetime).
  let mcpServerSnapshot = JSON.stringify(settingsStore.get().mcp_servers);
  settingsStore.subscribe((s) => {
    const nextMcpServerSnapshot = JSON.stringify(s.mcp_servers);
    if (nextMcpServerSnapshot !== mcpServerSnapshot) {
      mcpServerSnapshot = nextMcpServerSnapshot;
      void mcpAppRuntime.close();
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(PushChannel.SettingsChanged, s);
    }
  });

  // Wire permission / fs-approval response IPCs.
  registerBrokers();

  // Dev-only test hooks — let e2e tests inject canned session.ready /
  // session.event / session.complete payloads straight onto the renderer
  // push channel without spawning a real ACP child. Guarded by an env
  // var so production builds never expose these. Tests set
  // BACKCHAT_TEST_HOOKS=1 when launching electron.
  if (testHooksEnabled) {
    process.stdout.write("[ipc] test hooks enabled\n");
    ipcMain.handle(
      InvokeChannel.TestInjectSessionRow,
      (
        _e,
        p: {
          session_id: string;
          agent_id: string;
          cwd: string;
          acp_session_id?: string;
          supports_steering?: boolean;
          external_client?: string;
          supports_session_fork?: boolean;
          fork_support?: import("@openma/common/acp-runtime").AcpForkSupport;
        },
      ) => {
        // Canonical enrichment persists session.ready before broadcasting it.
        // Seed the parent row first so the event-log foreign key is valid.
        upsertSession({
          id: p.session_id,
          agent_id: p.agent_id,
          cwd: p.cwd,
          acp_session_id: p.acp_session_id ?? `acp-${p.session_id}`,
          last_used_at: Date.now(),
        });
        if (p.external_client?.trim()) {
          setSessionExternalClient(p.session_id, p.external_client.trim());
        }
        send({
          type: "session.ready",
          session_id: p.session_id,
          acp_session_id: p.acp_session_id ?? `acp-${p.session_id}`,
          agent_id: p.agent_id,
          cwd: p.cwd,
          // Capabilities a real session negotiates. A fixture that omits them
          // gets a session that genuinely cannot steer, which is what controls
          // gated on capability will show.
          ...(p.supports_steering === undefined
            ? {}
            : { supports_steering: p.supports_steering }),
          ...(p.external_client?.trim()
            ? { external_client: p.external_client.trim() }
            : {}),
          ...(p.supports_session_fork === undefined
            ? {}
            : { supports_session_fork: p.supports_session_fork }),
          ...(p.fork_support ? { fork_support: p.fork_support } : {}),
        });
      },
    );
    ipcMain.handle(
      InvokeChannel.TestInjectSessionEvent,
      (_e, msg: SessionEventOut) => {
        // Pass-through — test fully controls what shape it pushes.
        send(msg);
      },
    );
    ipcMain.handle(
      InvokeChannel.TestBeginBrokerRequest,
      (
        _e,
        p: {
          kind: "permission" | "fs-write" | "elicitation-form" | "elicitation-url" | "terminal";
          sessionId: string;
          cwd?: string;
          agentId?: string;
          params: Record<string, unknown>;
        },
      ) => {
        switch (p.kind) {
          case "permission":
            void requestPermission(p.sessionId, p.params, p.agentId).catch(() => undefined);
            return { started: true as const };
          case "fs-write":
            void writeTextFile(p.sessionId, p.cwd ?? "/tmp/backchat-e2e", p.params)
              .catch(() => undefined);
            return { started: true as const };
          case "elicitation-form":
            void requestElicitationForm(p.sessionId, p.params as never).catch(() => undefined);
            return { started: true as const };
          case "elicitation-url":
            void requestElicitationUrl(p.sessionId, p.params as never).catch(() => undefined);
            return { started: true as const };
          case "terminal":
            return createTerminal(p.sessionId, p.cwd ?? "/tmp/backchat-e2e", p.params);
        }
      },
    );
    ipcMain.handle(
      InvokeChannel.TestPersistSessionFixture,
      (
        _e,
        p: {
          sessionId: string;
          agentId?: string;
          cwd?: string;
          acpSessionId?: string;
          title?: string;
          events: Array<{ type: string; data: unknown; ts?: number }>;
        },
      ) => {
        const now = Date.now();
        upsertSession({
          id: p.sessionId,
          agent_id: p.agentId ?? "codex-acp",
          cwd: p.cwd ?? `/tmp/backchat-e2e/${p.sessionId}`,
          acp_session_id: p.acpSessionId ?? `acp-${p.sessionId}`,
          title: p.title ?? "",
          last_used_at: p.events.at(-1)?.ts ?? now,
        });
        if (p.title) setSessionTitleIfEmpty(p.sessionId, p.title);
        appendEventsTx(
          p.sessionId,
          p.events.map((event) => ({ type: event.type, data: event.data })),
        );
      },
    );
    ipcMain.handle(
      InvokeChannel.TestExportSessionFiles,
      (_e, opts: { overwrite?: boolean } = {}) => {
        const root = openmaRoot();
        return exportSessionFilesToDisk({
          dbPath: join(root, "sessions.db"),
          outputRoot: root,
          overwrite: opts.overwrite,
        });
      },
    );
    ipcMain.handle(InvokeChannel.TestReadSessionPrompts, () =>
      testPromptCalls.map((p) => ({ ...p })),
    );
    ipcMain.handle(InvokeChannel.TestReadSessionCommands, () =>
      testCommandCalls.map((p) => ({ ...p })),
    );
    ipcMain.handle(InvokeChannel.TestReadSessionConfigOptions, () =>
      testConfigOptionCalls.map((p) => ({ ...p })),
    );
    ipcMain.handle(
      InvokeChannel.TestSetAgentSetupFixture,
      (_e, fixture: TestAgentSetupFixture) => {
        testAgentSetupFixture = {
          ...fixture,
          calls: [],
        };
      },
    );
    ipcMain.handle(
      InvokeChannel.TestAgentSetupCalls,
      () => testAgentSetupFixture?.calls ?? [],
    );
    ipcMain.handle(
      InvokeChannel.TestBrowserTool,
      async (
        _event,
        p: { taskId: string; name: string; args?: Record<string, unknown> },
      ) => {
        const args = p.args ?? {};
        switch (p.name) {
          case "browser_tabs":
            return browserWebviewTools.tabs(p.taskId, args as never);
          case "browser_navigate":
            return browserWebviewTools.navigate(p.taskId, String(args["url"] ?? ""));
          case "browser_screenshot":
            return browserWebviewTools.screenshot(p.taskId, args["full_page"] === true);
          case "browser_click":
            return browserWebviewTools.click(p.taskId, String(args["selector"] ?? ""));
          case "browser_type":
            return browserWebviewTools.type(
              p.taskId,
              String(args["selector"] ?? ""),
              String(args["text"] ?? ""),
              args["submit"] === true,
            );
          case "browser_get_text":
            return browserWebviewTools.getText(
              p.taskId,
              typeof args["selector"] === "string" ? args["selector"] : undefined,
              typeof args["max_chars"] === "number" ? args["max_chars"] : undefined,
            );
          case "browser_eval":
            return browserWebviewTools.evaluate(
              p.taskId,
              String(args["expression"] ?? ""),
            );
          case "browser_close":
            return browserWebviewTools.close(p.taskId);
          default:
            throw new Error(`Unknown browser test tool: ${p.name}`);
        }
      },
    );
  }

  return {
    sessionManager,
    refreshPlugins() {
      pluginRuntime.refresh();
      void mcpAppRuntime.close();
    },
    async dispose() {
      scheduleEngine.stop();
      projectWork.stop();
      stopBrowserPluginState();
      await Promise.allSettled([
        sessionManager.disposeAll(),
        agentSetup.dispose(),
        mcpAppRuntime.close(),
        pluginSkillsMcpBridge.stop(),
        scheduleMcpBridge?.stop(),
        browserMcpHttpServer?.close(),
        chromeExtensionBridge?.close(),
        sessionHistoryMcpBridge.stop(),
      ]);
      const closedSocket = controlServer?.socketPath ?? "";
      await controlServer?.close();
      if (controlServer) recordUpdateEvidence("control-socket-closed", { socket: closedSocket });
      else recordUpdateEvidence("control-socket-missing", { socket: "" });
      await projectMcp?.close();
      await projectWork.close();
      scheduleStore.close();
    },
  };
}

function chromeExtensionBridgeMetadata(
  bridgePort: string,
  health?: ChromeExtensionBridgeHealth,
): Record<string, string> {
  const metadata: Record<string, string> = {
    bridgePort,
    bridgeStatus: health?.status ?? "starting",
  };
  if (!health) return metadata;

  metadata.bridgePendingCommands = String(health.pendingCommandCount);
  metadata.bridgeQueuedCommands = String(health.queuedCommandCount);
  if (health.lastConnectedAt) metadata.bridgeLastConnectedAt = health.lastConnectedAt;
  if (health.lastCommandAt) metadata.bridgeLastCommandAt = health.lastCommandAt;
  if (health.lastCommandType) metadata.bridgeLastCommandType = health.lastCommandType;
  if (health.lastError) metadata.bridgeLastError = health.lastError;
  return metadata;
}
