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
export type { ContentBlock, PromptCapabilities } from "@agentclientprotocol/sdk";

export { AcpRuntimeImpl } from "./runtime.js";
export { AcpSessionImpl } from "./session.js";

export { ACP_AUTH_REQUIRED_CODE, isAuthRequired } from "./errors.js";

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
