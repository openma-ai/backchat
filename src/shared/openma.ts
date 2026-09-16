/** Public desktop state. Credentials never cross the preload boundary. */
export interface OpenmaScope { baseUrl: string; userId: string; workspaceId: string }
export interface OpenmaProjectBinding { projectId: string; environmentId: string; runtimeId: string | null }

export interface OpenmaExecutionTarget extends OpenmaScope {
  kind: "cloud" | "runner";
  agentId: string; agentName: string;
  environmentId: string; environmentName: string;
  runtimeId: string | null; runtimeName: string;
}
export interface OpenmaTask extends OpenmaScope {
  id: string; sessionId: string; target: OpenmaExecutionTarget;
  title: string; status: "running" | "idle" | "rescheduling" | "terminated";
  createdAt: number; updatedAt: number; afterSeq: number;
  /** Personal desktop organization; it never archives/stops the service task. */
  pinnedAt?: number | null; archivedAt?: number | null;
  /** Monotonic desktop metadata revision, separate from the remote event cursor. */
  revision?: number;
}
export interface OpenmaTaskUpdate { title?: string; pinned?: boolean; archived?: boolean }
export interface OpenmaTaskSearchHit { task: OpenmaTask; seq: number; type: string; ts: number; snippet: string }
export type OpenmaTaskEvent = Record<string, unknown> & { type: string; id?: string; seq?: number };
export type OpenmaTaskResponse = { type: "confirmation"; result: "allow" | "deny" } | { type: "custom_result"; text: string; isError?: boolean };
export interface OpenmaTaskFile { id: string; name: string; path?: string; mediaType?: string; size?: number }
export interface OpenmaFilePreview { file: OpenmaTaskFile; text?: string; dataUrl?: string }
export interface OpenmaTaskOperation {
  id: string; event: OpenmaTaskEvent; state: "pending" | "accepted" | "uncertain"; createdAt: number;
}
export interface OpenmaTaskSnapshot {
  task: OpenmaTask; events: OpenmaTaskEvent[]; operations: OpenmaTaskOperation[];
  connection: "connecting" | "online" | "offline"; error?: string;
}

export interface OpenmaAccountState {
  status: "signed_out" | "signing_in" | "signed_in" | "expired";
  baseUrl: string;
  user: { id: string; email: string; name: string | null } | null;
  workspaces: Array<{ id: string; name: string; role: string; expired?: boolean }>;
  activeWorkspaceId: string | null;
}

export interface OpenmaAccountApi {
  openmaTasksList(scope?: OpenmaScope): Promise<OpenmaTask[]>;
  openmaTasksRefresh(scope?: OpenmaScope): Promise<OpenmaTask[]>;
  openmaTaskUpdate(id: string, patch: OpenmaTaskUpdate): Promise<OpenmaTask>;
  openmaTasksSearch(query: string, limit?: number): Promise<OpenmaTaskSearchHit[]>;
  onOpenmaTaskUpdated(handler: (task: OpenmaTask) => void): () => void;
  openmaTaskCreate(target: OpenmaExecutionTarget, title: string): Promise<OpenmaTaskSnapshot>;
  openmaTaskOpen(id: string, subscriptionId: string): Promise<OpenmaTaskSnapshot>;
  openmaTaskDetach(id: string, subscriptionId: string): Promise<void>;
  openmaTaskSend(id: string, operationId: string, text: string): Promise<void>;
  openmaTaskInterrupt(id: string): Promise<void>;
  openmaTaskRespond(id: string, requestId: string, response: OpenmaTaskResponse): Promise<void>;
  openmaTaskFiles(id: string): Promise<OpenmaTaskFile[]>;
  openmaTaskFilePreview(id: string, fileId: string): Promise<OpenmaFilePreview>;
  openmaTaskFileDownload(id: string, fileId: string): Promise<void>;
  onOpenmaTask(handler: (snapshot: OpenmaTaskSnapshot) => void): () => void;
  openmaAccountState(): Promise<OpenmaAccountState>;
  openmaLogin(baseUrl: string): Promise<void>;
  openmaCancelLogin(): Promise<void>;
  openmaLogout(): Promise<void>;
  openmaSelectWorkspace(workspaceId: string): Promise<void>;
  onOpenmaAccount(handler: (state: OpenmaAccountState) => void): () => void;
  openmaRunnerState(): Promise<OpenmaRunnerState>;
  openmaRunnerEnable(): Promise<void>;
  openmaRunnerDisable(): Promise<void>;
  onOpenmaRunner(handler: (state: OpenmaRunnerState) => void): () => void;
  openmaCatalog(scope?: OpenmaScope): Promise<OpenmaCatalog>;
  openmaProjectBindings(): Promise<OpenmaProjectBinding[]>;
  openmaLinkProject(binding: OpenmaProjectBinding): Promise<void>;
  openmaUnlinkProject(binding: OpenmaProjectBinding): Promise<void>;
  openmaOpenManagement(): Promise<void>;
}

export interface OpenmaCatalog {
  runners: Array<{
    id: string; machineId: string; name: string; status: "online" | "offline"; isLocal: boolean;
    agents: Array<{ id: string; bindings: Array<{ id: string; name: string }> }>;
  }>;
  cloudAgents: Array<{ id: string; name: string }>;
  environments: Array<{ id: string; name: string; type: "cloud" | "self_hosted"; runtimeId: string | null; projectName?: string }>;
}

export interface OpenmaRunnerState {
  enabled: boolean;
  /** Only a Backchat-hosted runner is stopped when this application exits. */
  hosting: "backchat" | "external" | null;
  status: "disabled" | "registering" | "connecting" | "online" | "offline" | "occupied" | "expired" | "error";
  runtimeId: string | null;
  machineId: string | null;
  message?: string;
}
