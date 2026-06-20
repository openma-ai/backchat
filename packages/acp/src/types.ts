/**
 * Core interfaces for spawning and driving an ACP-compatible agent.
 *
 *   [Spawner]            How a child process gets started + its stdio.
 *   [ChildHandle]        The opaque process — read stdout, write stdin,
 *                        wait for exit, kill.
 *   [AcpRuntime]         Wraps a ChildHandle in @agentclientprotocol/sdk's
 *                        ClientSideConnection. Owns the conversation:
 *                        new session → prompt → stream events → close.
 */

import type * as schema from "@agentclientprotocol/sdk";

export interface AgentSpec {
  /** Executable name or absolute path. */
  command: string;
  args?: string[];
  /** Process env. Inherits the spawner's env; spec entries override. An entry
   *  with `undefined` value EXPLICITLY UNSETS the inherited key — useful for
   *  scrubbing variables like `CLAUDECODE` that mark the parent as already
   *  inside a Claude Code session and would make a nested ACP child refuse
   *  to start. */
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface ChildHandle {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal?: "SIGTERM" | "SIGKILL"): Promise<void>;
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export interface Spawner {
  spawn(spec: AgentSpec): Promise<ChildHandle>;
}

export interface RestartPolicy {
  mode: "never" | "on-crash" | "always";
  maxRestarts?: number;
  windowMs?: number;
}

/**
 * Hooks the host (= the desktop main process) wires in to handle ACP
 * client-side requests. The runtime never decides policy; everything that
 * needs a UI (permission dialog, file diff prompt, terminal panel) bubbles up
 * through these callbacks.
 *
 * Every callback BLOCKS the way ACP's RPC blocks — the agent waits for the
 * response before continuing. Don't queue these into a "later" lane.
 *
 * Unimplemented hooks fall back to a sensible default (deny / throw); the
 * agent then sees the corresponding ACP failure and surfaces it as an error
 * in the chat stream.
 */
export interface ClientCallbacks {
  requestPermission?(
    params: schema.RequestPermissionRequest,
  ): Promise<schema.RequestPermissionResponse>;
  readTextFile?(params: schema.ReadTextFileRequest): Promise<schema.ReadTextFileResponse>;
  writeTextFile?(params: schema.WriteTextFileRequest): Promise<schema.WriteTextFileResponse>;
  createTerminal?(params: schema.CreateTerminalRequest): Promise<schema.CreateTerminalResponse>;
  terminalOutput?(params: schema.TerminalOutputRequest): Promise<schema.TerminalOutputResponse>;
  releaseTerminal?(
    params: schema.ReleaseTerminalRequest,
  ): Promise<schema.ReleaseTerminalResponse | void>;
  waitForTerminalExit?(
    params: schema.WaitForTerminalExitRequest,
  ): Promise<schema.WaitForTerminalExitResponse>;
  killTerminal?(params: schema.KillTerminalRequest): Promise<schema.KillTerminalResponse | void>;
}

export interface SessionOptions {
  agent: AgentSpec;
  restart?: RestartPolicy;
  /** If the session sees no inbound prompts for this long, the runtime kills
   *  the child. 0 disables. Default: 30 minutes. */
  idleTimeoutMs?: number;
  /** Hard cap on a single prompt/turn. Default: 10 min. */
  perTurnTimeoutMs?: number;
  /** If set, init() calls ACP `session/load` with this id instead of
   *  `session/new`. Powers cross-process resume. Agents that don't support
   *  loadSession fall back to a fresh `session/new` and the caller is
   *  expected to surface the loss of history. */
  resumeAcpSessionId?: string;
  /** MCP servers to advertise to the ACP child via `session/new`'s
   *  `mcpServers` array. Per the ACP schema each entry is one of three
   *  variants: { type: "http"|"sse", name, url, headers } | { type: "stdio",
   *  name, command, args, env }. The caller (SessionManager) builds these
   *  from McpConfigStore. */
  mcpServers?: schema.McpServer[];
  /** Optional client-side callbacks. The runtime registers these on the SDK
   *  ClientSideConnection so the agent's permission / file / terminal
   *  requests reach the host's UI brokers. */
  clientCallbacks?: ClientCallbacks;
}

export interface AcpSession {
  readonly id: string;
  readonly acpSessionId: string;
  readonly options: SessionOptions;
  /** Auth methods the agent advertised on `initialize.authMethods`.
   *  Settings UI reads this to render per-agent "Sign in / switch
   *  account" panels. Empty when the agent has no auth gate. */
  readonly authMethods: readonly schema.AuthMethod[];
  /** Agent identification (name + version) reported on initialize. */
  readonly agentInfo: schema.Implementation | null;
  /** Current ACP session configuration options, including model selectors. */
  readonly configOptions: readonly schema.SessionConfigOption[];
  /** Prompt capabilities advertised by initialize.promptCapabilities.
   *  Text and resource_link are baseline; optional media/content
   *  blocks are gated by this object. */
  readonly promptCapabilities: schema.PromptCapabilities;
  prompt(
    input: string | readonly schema.ContentBlock[],
    opts?: { abortSignal?: AbortSignal },
  ): AsyncIterable<unknown>;
  /** Set one ACP session configuration option and return the full updated state. */
  setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<readonly schema.SessionConfigOption[]>;
  /** Drive a user-initiated signin. The agent's sub-flow (OAuth
   *  browser handoff, API-key validation, …) blocks until done; on
   *  failure the agent's error propagates unchanged. */
  authenticate(methodId: string): Promise<void>;
  /** Switch agent into a named session mode (e.g. codex `auto`,
   *  `full-access`). No-op when the agent doesn't expose
   *  setSessionMode in its capability surface. */
  setMode(modeId: string): Promise<void>;
  isAlive(): boolean;
  dispose(): Promise<void>;
}

export interface AcpRuntime {
  start(options: SessionOptions): Promise<AcpSession>;
}
