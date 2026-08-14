export interface ManagedAgentsLabTaskInput {
  model: string;
  prompt: string;
}

export interface ManagedAgentsLabStartInput extends ManagedAgentsLabTaskInput {
  baseUrl: string;
  apiKey: string;
}

export interface ManagedAgentsLabConnectionInput {
  baseUrl: string;
  apiKey: string;
}

export interface ManagedAgentsLabModelOption {
  id: string;
  displayName: string;
}

export interface ManagedAgentsLabResult {
  agentId: string;
  environmentId: string;
  sessionId: string;
  eventTypes: string[];
  tunnelStatus: string;
}

export type ManagedAgentsLabEvent =
  | {
      runId: string;
      at: number;
      kind: "status";
      type: string;
      data?: Record<string, unknown>;
    }
  | {
      runId: string;
      at: number;
      kind: "http";
      method: string;
      path: string;
      status?: number;
      durationMs?: number;
    }
  | {
      runId: string;
      at: number;
      kind: "sdk_event";
      type: string;
      data: Record<string, unknown>;
    }
  | {
      runId: string;
      at: number;
      kind: "completed";
      result: ManagedAgentsLabResult;
    }
  | {
      runId: string;
      at: number;
      kind: "error";
      message: string;
    };
