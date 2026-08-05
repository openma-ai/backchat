import type {
  AcpSession as SharedAcpSession,
  SessionOptions as SharedSessionOptions,
} from "@openma/common/acp-runtime";

export type {
  AgentSpec,
  ChildHandle,
  Spawner,
  RestartPolicy,
  ClientCallbacks,
  SteeringOutcome,
} from "@openma/common/acp-runtime";

/** Shared ACP runtime contract, including native additional workspace roots. */
export interface SessionOptions extends SharedSessionOptions {}

export interface AcpSession extends Omit<SharedAcpSession, "options"> {
  readonly options: SessionOptions;
}

export interface AcpRuntime {
  start(options: SessionOptions): Promise<AcpSession>;
}
