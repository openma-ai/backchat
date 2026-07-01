import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AuthMethod,
  type Client,
  type ClientCapabilities,
  type InitializeResponse,
  type NewSessionResponse,
  type SessionConfigOption,
  type SessionModeState,
} from "@agentclientprotocol/sdk";
import { NodeSpawner } from "./spawners/node.js";
import type { AgentSpec, ChildHandle, Spawner } from "./types.js";

export interface ProbeAgentConfigOptionsOptions {
  agent: AgentSpec;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  spawner?: Spawner;
}

export interface ProbeAgentSessionConfigResult {
  configOptions: SessionConfigOption[];
  modes?: SessionModeState | null;
}

export interface AuthenticateAgentOptions {
  agent: AgentSpec;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  agentAuthLaunchGraceMs?: number;
  backgroundAuthTimeoutMs?: number;
  spawner?: Spawner;
  methodId?: string;
  launchInteractiveAuth?: (options: TerminalAuthLaunchOptions) => Promise<void>;
}

export interface AuthenticateAgentResult {
  status: "completed" | "started";
}

export interface ProbeAgentAuthStatusOptions {
  agent: AgentSpec;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  spawner?: Spawner;
}

export interface ProbeAgentAuthMethod {
  id: string;
  name?: string;
  description?: string;
  type: string;
  vars?: Array<{
    name: string;
    label?: string;
    secret?: boolean;
    optional?: boolean;
  }>;
  link?: string;
  terminalLaunch?: TerminalAuthLaunchOptions;
}

export interface ProbeAgentAuthStatus {
  status: "configured" | "needs-auth" | "none" | "unknown";
  methodId?: string;
  methodName?: string;
  methods?: ProbeAgentAuthMethod[];
  message?: string;
}

export interface TerminalAuthLaunchOptions {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

const ACP_AUTH_REQUIRED_CODE = -32000;
const ACP_CLIENT_CAPABILITIES: ClientCapabilities = {
  fs: {
    readTextFile: true,
    writeTextFile: true,
  },
  terminal: true,
  auth: {
    terminal: true,
  },
  _meta: {
    "terminal-auth": true,
    terminal_output: true,
  },
};

function authMethodType(method: AuthMethod): string {
  const type = (method as { type?: unknown }).type;
  if (typeof type === "string") return type;
  const meta = authMethodMeta(method);
  const metaType = meta?.type;
  return typeof metaType === "string" ? metaType : "agent";
}

function isSupportedAuthMethod(method: AuthMethod): boolean {
  const type = authMethodType(method);
  return type === "agent" || type === "terminal" || type === "env_var";
}

function supportedAuthMethods(authMethods: unknown): AuthMethod[] {
  if (!Array.isArray(authMethods)) return [];
  return authMethods.filter((method): method is AuthMethod => {
    if (!method || typeof method !== "object") return false;
    const typed = method as AuthMethod & { id?: unknown };
    return typeof typed.id === "string" && typed.id.length > 0 && isSupportedAuthMethod(typed);
  });
}

function declaredAuthMethods(authMethods: unknown): AuthMethod[] {
  if (!Array.isArray(authMethods)) return [];
  return authMethods.filter((method): method is AuthMethod => {
    if (!method || typeof method !== "object") return false;
    const typed = method as AuthMethod & { id?: unknown };
    return typeof typed.id === "string" && typed.id.length > 0;
  });
}

function unsupportedAuthMethodTypes(methods: AuthMethod[]): string[] {
  return [...new Set(
    methods
      .filter((method) => !isSupportedAuthMethod(method))
      .map(authMethodType)
      .filter((type) => type.length > 0),
  )];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function authMethodMeta(method: AuthMethod): Record<string, unknown> | null {
  const meta = (method as { _meta?: unknown; meta?: unknown })._meta ?? (method as { meta?: unknown }).meta;
  return isRecord(meta) ? meta : null;
}

function terminalAuthMeta(method: AuthMethod): TerminalAuthLaunchOptions | null {
  const meta = authMethodMeta(method);
  if (!meta) return null;
  const terminalAuth = meta["terminal-auth"];
  if (!isRecord(terminalAuth)) return null;
  if (typeof terminalAuth.command !== "string" || terminalAuth.command.length === 0) return null;
  return {
    label: typeof terminalAuth.label === "string" && terminalAuth.label.length > 0
      ? terminalAuth.label
      : authMethodName(method) ?? "Login",
    command: terminalAuth.command,
    args: stringArray(terminalAuth.args),
    ...(stringRecord(terminalAuth.env) ? { env: stringRecord(terminalAuth.env) } : {}),
  };
}

function parseGeneratedShellShimCommand(command: string): string | null {
  try {
    const text = readFileSync(command, "utf8");
    const execLine = text.split("\n").find((line) => line.startsWith("exec ") && line.includes('"$@"'));
    if (!execLine) return null;
    const match = execLine.match(/^exec\s+'([^']+)'(?:\s|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function terminalAuthCommand(command: string): string {
  return parseGeneratedShellShimCommand(command) ?? command;
}

function terminalAuthFromMethod(
  method: AuthMethod,
  agent: AgentSpec,
  env: Record<string, string>,
  cwd: string,
): TerminalAuthLaunchOptions | null {
  const metaAuth = terminalAuthMeta(method);
  if (metaAuth) return { ...metaAuth, cwd };
  if (authMethodType(method) !== "terminal") return null;
  const terminalMethod = method as AuthMethod & { args?: unknown; env?: unknown };
  const meta = authMethodMeta(method);
  const methodEnv = stringRecord(terminalMethod.env) ?? {};
  const metaEnv = stringRecord(meta?.env) ?? {};
  const metaArgs = stringArray(meta?.args);
  const command = typeof meta?.command === "string" && meta.command.length > 0
    ? meta.command
    : terminalAuthCommand(agent.command);
  return {
    label: authMethodName(method) ?? "Login",
    command,
    args: metaArgs.length > 0 ? metaArgs : stringArray(terminalMethod.args),
    env: {
      ...env,
      ...methodEnv,
      ...metaEnv,
    },
    cwd,
  };
}

function authEnvVars(method: AuthMethod): ProbeAgentAuthMethod["vars"] | undefined {
  if (authMethodType(method) !== "env_var") return undefined;
  const vars = (method as AuthMethod & { vars?: unknown }).vars;
  if (!Array.isArray(vars)) return undefined;
  const normalized = vars.flatMap((item): NonNullable<ProbeAgentAuthMethod["vars"]> => {
    if (!item || typeof item !== "object") return [];
    const typed = item as { name?: unknown; label?: unknown; secret?: unknown; optional?: unknown };
    if (typeof typed.name !== "string" || typed.name.length === 0) return [];
    return [{
      name: typed.name,
      ...(typeof typed.label === "string" && typed.label.length > 0 ? { label: typed.label } : {}),
      ...(typeof typed.secret === "boolean" ? { secret: typed.secret } : {}),
      ...(typeof typed.optional === "boolean" ? { optional: typed.optional } : {}),
    }];
  });
  return normalized.length > 0 ? normalized : undefined;
}

function authMethodLink(method: AuthMethod): string | undefined {
  const link = (method as AuthMethod & { link?: unknown }).link;
  return typeof link === "string" && link.length > 0 ? link : undefined;
}

function selectAuthMethod(authMethods: unknown, methodId?: string): AuthMethod | null {
  const methods = supportedAuthMethods(authMethods);
  if (!methodId) return methods[0] ?? null;
  return methods.find((method) => method.id === methodId) ?? null;
}

function isAuthRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const typed = error as { code?: unknown; message?: unknown };
  return (
    typed.code === ACP_AUTH_REQUIRED_CODE &&
    typeof typed.message === "string" &&
    /^Authentication required\b/i.test(typed.message)
  );
}

function authMethodName(method: AuthMethod | null): string | undefined {
  if (!method) return undefined;
  const name = (method as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function authMethodDescription(method: AuthMethod | null): string | undefined {
  if (!method) return undefined;
  const description = (method as { description?: unknown }).description;
  return typeof description === "string" && description.length > 0 ? description : undefined;
}

function inferredCredentialVars(method: AuthMethod): ProbeAgentAuthMethod["vars"] | undefined {
  const description = authMethodDescription(method);
  if (!description || !/\benvironment variable\b|\benv(?:ironment)? var\b/i.test(description)) return undefined;
  const names = [...new Set(
    [...description.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)]
      .flatMap((match) => match[1] ? [match[1]] : []),
  )];
  if (names.length === 0) return undefined;
  return names.map((name) => ({
    name,
    secret: /(?:^|_)(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:_|$)/.test(name),
  }));
}

function credentialVars(method: AuthMethod): ProbeAgentAuthMethod["vars"] | undefined {
  return authEnvVars(method) ?? inferredCredentialVars(method);
}

function isCredentialPromptAuthMethod(method: AuthMethod): boolean {
  const type = authMethodType(method);
  return type === "env_var" || (type === "terminal" && Boolean(inferredCredentialVars(method)));
}

function credentialVariableNames(method: AuthMethod): string | undefined {
  return credentialVars(method)?.map((item) => item.name).join(", ");
}

function missingCredentialVariableNames(
  method: AuthMethod,
  env: Record<string, string>,
): string[] {
  return (credentialVars(method) ?? [])
    .filter((variable) => variable.optional !== true)
    .map((variable) => variable.name)
    .filter((name) => !env[name]);
}

function publicAuthMethods(
  methods: AuthMethod[],
  agent: AgentSpec,
  env: Record<string, string>,
  cwd: string,
): ProbeAgentAuthMethod[] {
  return methods.map((method) => {
    const vars = credentialVars(method);
    const type = isCredentialPromptAuthMethod(method) ? "env_var" : authMethodType(method);
    const terminalLaunch = type === "terminal" ? terminalAuthFromMethod(method, agent, env, cwd) : null;
    return {
      id: method.id,
      ...(authMethodName(method) ? { name: authMethodName(method) } : {}),
      ...(authMethodDescription(method) ? { description: authMethodDescription(method) } : {}),
      type,
      ...(vars ? { vars } : {}),
      ...(authMethodLink(method) ? { link: authMethodLink(method) } : {}),
      ...(terminalLaunch ? { terminalLaunch } : {}),
    };
  });
}

function acpErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as { data?: unknown }).data;
    if (isRecord(data)) {
      const details = data.details;
      if (typeof details === "string" && details.length > 0) return details;
      const message = data.message;
      if (typeof message === "string" && message.length > 0) return message;
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return String(error);
}

function withAcpDetails(error: unknown): unknown {
  const message = acpErrorMessage(error);
  if (error instanceof Error && message === error.message) return error;
  const next = new Error(message);
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    const data = (error as { data?: unknown }).data;
    if (typeof code === "number") (next as Error & { code?: number }).code = code;
    if (data !== undefined) (next as Error & { data?: unknown }).data = data;
  }
  return next;
}

function authMethodStatusFields(
  method: AuthMethod,
  methods: AuthMethod[],
  agent: AgentSpec,
  env: Record<string, string>,
  cwd: string,
): Pick<ProbeAgentAuthStatus, "methodId" | "methodName" | "methods"> {
  const methodName = authMethodName(method);
  return {
    methodId: method.id,
    ...(methodName ? { methodName } : {}),
    methods: publicAuthMethods(methods, agent, env, cwd),
  };
}

function publicEnv(env: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const entries = Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function mergedStringEnv(
  ...envs: Array<Record<string, string | undefined> | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const env of envs) {
    for (const [key, value] of Object.entries(env ?? {})) {
      if (typeof value === "string") out[key] = value;
    }
  }
  return out;
}

function envArrayToRecord(env: Array<{ name?: unknown; value?: unknown }> | undefined): Record<string, string> | undefined {
  if (!Array.isArray(env)) return undefined;
  const entries = env.filter((entry): entry is { name: string; value: string } => (
    typeof entry.name === "string" &&
    entry.name.length > 0 &&
    typeof entry.value === "string"
  )).map((entry) => [entry.name, entry.value] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function configOptionsFromResponse(
  value: NewSessionResponse | { configOptions?: SessionConfigOption[] | null } | undefined,
): SessionConfigOption[] {
  return Array.isArray(value?.configOptions)
    ? value.configOptions.map((option) => structuredClone(option))
    : [];
}

function configOptionsFromSessionUpdate(update: unknown): SessionConfigOption[] | null {
  if (!update || typeof update !== "object") return null;
  const typed = update as { sessionUpdate?: unknown; configOptions?: unknown };
  if (typed.sessionUpdate !== "config_option_update" || !Array.isArray(typed.configOptions)) return null;
  return typed.configOptions.map((option) => structuredClone(option));
}

function modesFromResponse(value: NewSessionResponse | { modes?: SessionModeState | null } | undefined): SessionModeState | null {
  return value?.modes ? structuredClone(value.modes) : null;
}

function modeFromSessionUpdate(update: unknown): string | null {
  if (!update || typeof update !== "object") return null;
  const typed = update as { sessionUpdate?: unknown; currentModeId?: unknown };
  if (typed.sessionUpdate !== "current_mode_update" || typeof typed.currentModeId !== "string") return null;
  return typed.currentModeId;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function spawnAcpProbeAgent(
  options: {
    agent: AgentSpec;
    cwd: string;
    env?: Record<string, string | undefined>;
    spawner?: Spawner;
    client?: Client;
  },
): Promise<{
  agent: Agent;
  child: ChildHandle;
  env: Record<string, string>;
  diagnosticLines: string[];
  dispose: () => Promise<void>;
}> {
  const env = mergedStringEnv(options.agent.env, options.env);
  const diagnosticLines: string[] = [];
  const onDiagnosticLine = options.agent.onDiagnosticLine;
  const spawner = options.spawner ?? new NodeSpawner();
  const child = await spawner.spawn({
    ...options.agent,
    cwd: options.cwd,
    env,
    onDiagnosticLine: (line) => {
      diagnosticLines.push(line);
      onDiagnosticLine?.(line);
    },
  });
  const stream = ndJsonStream(child.stdin, child.stdout);
  const agent: Agent = new ClientSideConnection(
    (): Client => options.client ?? {
      sessionUpdate: async () => undefined,
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    },
    stream,
  );
  return {
    agent,
    child,
    env,
    diagnosticLines,
    dispose: () => child.kill().catch(() => undefined),
  };
}

function initializeAcpAgent(agent: Agent): Promise<InitializeResponse> {
  return Promise.resolve(agent.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: ACP_CLIENT_CAPABILITIES,
  }));
}

function createAcpProbeSession(agent: Agent, cwd: string): Promise<NewSessionResponse> {
  return Promise.resolve(agent.newSession({
    cwd,
    mcpServers: [],
  }));
}

function unauthenticatedDiagnostic(lines: string[]): string | null {
  for (const line of lines) {
    const plain = line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trim();
    if (/\bcreating session without credentials\b/i.test(plain)) {
      return plain.replace(/^.*?\bcreating session without credentials\b/i, "Creating session without credentials");
    }
    if (/\bagent may not work\b/i.test(plain) && /\bcredentials?\b/i.test(plain)) {
      return plain;
    }
  }
  return null;
}

async function allowDiagnosticsToFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

export async function probeAgentSessionConfig(
  options: ProbeAgentConfigOptionsOptions,
): Promise<ProbeAgentSessionConfigResult> {
  const cwd = options.cwd ?? join(tmpdir(), "backchat-acp-probe");
  await mkdir(cwd, { recursive: true });

  let updatedConfigOptions: SessionConfigOption[] = [];
  let updatedModeId: string | null = null;
  const client: Client = {
    sessionUpdate: async (params) => {
      const next = configOptionsFromSessionUpdate(params.update);
      if (next) updatedConfigOptions = next;
      const modeId = modeFromSessionUpdate(params.update);
      if (modeId) updatedModeId = modeId;
    },
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
  };
  const connection = await spawnAcpProbeAgent({
    agent: options.agent,
    cwd,
    env: options.env,
    spawner: options.spawner,
    client,
  });
  const timeoutMs = options.timeoutMs ?? 15_000;
  try {
    return await withTimeout(
      (async () => {
        await initializeAcpAgent(connection.agent);
        try {
          const session = await createAcpProbeSession(connection.agent, cwd);
          const responseConfigOptions = configOptionsFromResponse(session);
          const modes = modesFromResponse(session);
          return {
            configOptions: responseConfigOptions.length > 0 ? responseConfigOptions : updatedConfigOptions,
            ...(modes ? { modes: updatedModeId ? { ...modes, currentModeId: updatedModeId } : modes } : {}),
          };
        } catch (error) {
          if (isAuthRequiredError(error)) return { configOptions: [] };
          throw error;
        }
      })(),
      timeoutMs,
      `ACP agent config probe timed out after ${timeoutMs}ms`,
    );
  } finally {
    await connection.dispose();
  }
}

export async function probeAgentConfigOptions(
  options: ProbeAgentConfigOptionsOptions,
): Promise<SessionConfigOption[]> {
  return (await probeAgentSessionConfig(options)).configOptions;
}

export async function authenticateAgent(options: AuthenticateAgentOptions): Promise<AuthenticateAgentResult> {
  const cwd = options.cwd ?? join(tmpdir(), "backchat-acp-auth");
  await mkdir(cwd, { recursive: true });

  const env = mergedStringEnv(options.agent.env, options.env);
  let authTerminalId = 0;
  let activeAuthMethodName = "Agent";
  let resolveTerminalLaunch: (() => void) | null = null;
  let rejectTerminalLaunch: ((error: unknown) => void) | null = null;
  const terminalLaunch = new Promise<void>((resolve, reject) => {
    resolveTerminalLaunch = resolve;
    rejectTerminalLaunch = reject;
  });
  void terminalLaunch.catch(() => undefined);
  const client: Client = {
    sessionUpdate: async () => undefined,
    requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    createTerminal: async (params) => {
      if (!options.launchInteractiveAuth) {
        throw new Error("ACP auth requested a terminal, but this host cannot open one.");
      }
      const terminalId = `auth-terminal-${++authTerminalId}`;
      try {
        await options.launchInteractiveAuth({
          label: `${activeAuthMethodName} auth`,
          command: params.command,
          args: params.args ?? [],
          ...(envArrayToRecord(params.env) ? { env: envArrayToRecord(params.env) } : {}),
          cwd: params.cwd ?? cwd,
        });
        resolveTerminalLaunch?.();
        return { terminalId };
      } catch (error) {
        rejectTerminalLaunch?.(error);
        throw error;
      }
    },
    terminalOutput: async () => ({
      output: "",
      truncated: false,
    }),
    waitForTerminalExit: async () => new Promise(() => undefined),
    releaseTerminal: async () => undefined,
    killTerminal: async () => undefined,
  };
  const connection = await spawnAcpProbeAgent({
    agent: options.agent,
    cwd,
    env: options.env,
    spawner: options.spawner,
    client,
  });
  const agent = connection.agent;

  const timeoutMs = options.timeoutMs ?? 120_000;
  const agentAuthLaunchGraceMs = options.agentAuthLaunchGraceMs ?? 0;
  const backgroundAuthTimeoutMs = options.backgroundAuthTimeoutMs ?? 10 * 60_000;
  let keepChildAliveForBackgroundAuth = false;
  let timer: NodeJS.Timeout | undefined;
  const keepBackgroundAuthAlive = (authPromise: Promise<unknown>) => {
    keepChildAliveForBackgroundAuth = true;
    let backgroundTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      void connection.child.kill().catch(() => undefined);
      backgroundTimer = undefined;
    }, backgroundAuthTimeoutMs);
    backgroundTimer.unref?.();
    void (async () => {
      try {
        await authPromise;
      } catch {
        // Browser-hosted auth may be cancelled after the browser has opened.
      } finally {
        if (backgroundTimer) clearTimeout(backgroundTimer);
        await connection.child.kill().catch(() => undefined);
      }
    })();
  };
  try {
    return await Promise.race([
      (async () => {
        const initResult = await initializeAcpAgent(agent);
        const method = selectAuthMethod(initResult.authMethods, options.methodId);
        if (!method) {
          throw new Error(options.methodId
            ? `ACP auth method is unavailable or not supported: ${options.methodId}`
            : "No supported ACP auth method is available for this agent");
        }
        if (isCredentialPromptAuthMethod(method)) {
          const vars = credentialVariableNames(method);
          throw new Error(vars
            ? `ACP auth method ${method.id} requires credential variables (${vars}) and cannot be started as a sign-in flow.`
            : `ACP auth method ${method.id} requires credential variables and cannot be started as a sign-in flow.`);
        }
        const terminalAuth = terminalAuthFromMethod(method, options.agent, env, cwd);
        if (terminalAuth) {
          if (!options.launchInteractiveAuth) {
            throw new Error(`ACP auth method ${method.id} requires an interactive terminal, but this host cannot open one.`);
          }
          await options.launchInteractiveAuth(terminalAuth);
          return { status: "started" as const };
        }
        activeAuthMethodName = authMethodName(method) ?? "Agent";
        const authPromise = Promise.resolve(agent.authenticate({ methodId: method.id }))
          .catch((error) => {
            throw withAcpDetails(error);
          });
        void authPromise.catch(() => undefined);
        let launchGraceTimer: NodeJS.Timeout | undefined;
        const launchGrace = agentAuthLaunchGraceMs > 0
          ? new Promise<"launched">((resolve) => {
              launchGraceTimer = setTimeout(() => resolve("launched"), agentAuthLaunchGraceMs);
              launchGraceTimer.unref?.();
            })
          : null;
        try {
          const result = await Promise.race([
            authPromise.then(() => "complete" as const),
            terminalLaunch.then(() => "terminal" as const),
            ...(launchGrace ? [launchGrace] : []),
          ]);
          if (result === "launched") {
            keepBackgroundAuthAlive(authPromise);
            return { status: "started" as const };
          }
          return { status: result === "complete" ? "completed" as const : "started" as const };
        } finally {
          if (launchGraceTimer) clearTimeout(launchGraceTimer);
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`ACP auth timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (!keepChildAliveForBackgroundAuth) {
      await connection.dispose();
    }
  }
}

export async function probeAgentAuthStatus(
  options: ProbeAgentAuthStatusOptions,
): Promise<ProbeAgentAuthStatus> {
  const cwd = options.cwd ?? join(tmpdir(), "backchat-acp-auth-probe");
  await mkdir(cwd, { recursive: true });

  const connection = await spawnAcpProbeAgent({
    agent: options.agent,
    cwd,
    env: options.env,
    spawner: options.spawner,
  });

  const timeoutMs = options.timeoutMs ?? 15_000;
  try {
    return await withTimeout(
      (async (): Promise<ProbeAgentAuthStatus> => {
        const initResult = await initializeAcpAgent(connection.agent);
        const methods = supportedAuthMethods(initResult.authMethods);
        const method = selectAuthMethod(initResult.authMethods);
        if (!method) {
          const declared = declaredAuthMethods(initResult.authMethods);
          if (declared.length > 0) {
            const unsupported = unsupportedAuthMethodTypes(declared);
            return {
              status: "unknown" as const,
              message: unsupported.length > 0
                ? `No supported ACP auth method is available. Unsupported methods: ${unsupported.join(", ")}.`
                : "No supported ACP auth method is available.",
            };
          }
          return { status: "none" as const };
        }
        const methodFields = authMethodStatusFields(method, methods, options.agent, connection.env, cwd);
        if (isCredentialPromptAuthMethod(method)) {
          const missing = missingCredentialVariableNames(method, connection.env);
          if (missing.length > 0) {
            return {
              status: "needs-auth" as const,
              ...methodFields,
              message:
                missing.length === 1
                  ? `Missing credential variable: ${missing[0]}.`
                  : `Missing credential variables: ${missing.join(", ")}.`,
            };
          }
        }
        try {
          await createAcpProbeSession(connection.agent, cwd);
          await allowDiagnosticsToFlush();
          const diagnostic = unauthenticatedDiagnostic(connection.diagnosticLines);
          if (diagnostic) {
            return {
              status: "needs-auth" as const,
              ...methodFields,
              message: diagnostic,
            };
          }
          return {
            status: "configured" as const,
            ...methodFields,
          };
        } catch (error) {
          if (!isAuthRequiredError(error)) {
            return {
              status: "unknown" as const,
              message: acpErrorMessage(error),
              ...methodFields,
            };
          }
          return {
            status: "needs-auth" as const,
            ...methodFields,
          };
        }
      })(),
      timeoutMs,
      `ACP auth probe timed out after ${timeoutMs}ms`,
    );
  } finally {
    await connection.dispose();
  }
}
