export type {
  AgentSpec,
  ChildHandle,
  Spawner,
  AcpSession,
  AcpRuntime,
  RestartPolicy,
  SessionOptions,
  ClientCallbacks,
} from "./types.js";

export { AcpRuntimeImpl } from "./runtime.js";
export { AcpSessionImpl } from "./session.js";

export {
  OVERLAY_AGENTS,
  resolveOverlayAgent,
  resolveKnownAgent,
  getKnownAgents,
  loadRegistry,
  detect,
  detectAll,
  type KnownAgentEntry,
} from "./registry.js";
