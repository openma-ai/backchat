import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname, platform } from "node:os";
import { join } from "node:path";
import { browserRuntimeAuthorization, openmaBaseUrl, type OpenmaConnection } from "./openma-account.js";
import { OmaBridgeClient, type OmaBridgeCredentials } from "./oma-bridge.js";
import type { OpenmaRunnerState } from "../shared/openma.js";
import type { SessionEventOut } from "../shared/session-events.js";
import type { OpenmaScope } from "../shared/openma.js";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";
import { OpenmaRunnerOutbox } from "./openma-runner-outbox.js";

type BridgeDeps = ConstructorParameters<typeof OmaBridgeClient>[0];
type Bridge = Pick<OmaBridgeClient, "connect" | "stop" | "handleSessionEvent"> & Partial<Pick<OmaBridgeClient, "requestPermission" | "cancelPendingFor" | "resume">>;
interface RunnerCredentials extends OmaBridgeCredentials {
  v: 2;
  runtimeId: string;
  tenants: Array<{ id: string; name: string; agentApiKey: string }>;
}
interface RuntimeIdentity {
  runtime: { id: string; machine_id: string; status: string; last_heartbeat: number | null };
  tenants: Array<{ id: string }>;
}
class RunnerAuthorizationError extends Error {}
function runtimeOnline(me: RuntimeIdentity): boolean {
  // RuntimeRoom expires a silent execution lease after 90 seconds. Its D1
  // status row alone can outlive a crashed host until the next attachment.
  return me.runtime.status === "online" && typeof me.runtime.last_heartbeat === "number"
    && Date.now() / 1000 - me.runtime.last_heartbeat < 90;
}
interface RunnerOptions {
  directory: string;
  bridgeDirectory: string;
  connection: () => OpenmaConnection;
  host: BridgeDeps["host"];
  detectAgents: BridgeDeps["detectAgents"];
  version?: string;
  openExternal?: (url: string) => Promise<void>;
  authorize?: typeof browserRuntimeAuthorization;
  fetchImpl?: typeof fetch;
  createBridge?: (deps: BridgeDeps) => Bridge;
  inspectDaemon?: () => Promise<{ pid: number; running: boolean } | null>;
  onChange?: (state: OpenmaRunnerState) => void;
  resolveProject?: (scope: OpenmaScope, runtimeId: string, environmentId: string, sessionId: string, agentId: string) => {
    localSessionId: string; projectId: string; cwd: string; additionalDirectories: string[];
  };
}

async function jsonFile(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Could not read the runner configuration"); }
}
async function savePrivateJson(directory: string, name: string, value: unknown) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, name);
  await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await chmod(`${path}.tmp`, 0o600);
  await rename(`${path}.tmp`, path);
}

/** Owns only Backchat's opt-in bridge. It never starts/stops a CLI service implicitly. */
export class OpenmaRunner {
  #options: RunnerOptions;
  #state: OpenmaRunnerState = { enabled: false, hosting: null, status: "disabled", runtimeId: null, machineId: null };
  #bridge: Bridge | null = null;
  #outbox: OpenmaRunnerOutbox | null = null;
  #operation: AbortController | null = null;
  #owner: Pick<OpenmaConnection, "userId" | "baseUrl"> | null = null;
  #writes: Promise<void> = Promise.resolve();
  #observation: AbortController | null = null;
  #poll: ReturnType<typeof setTimeout> | null = null;
  constructor(options: RunnerOptions) { this.#options = options; }
  state(): OpenmaRunnerState { return { ...this.#state }; }
  #update(patch: Partial<OpenmaRunnerState>) { this.#state = { ...this.#state, ...patch }; this.#options.onChange?.(this.state()); }
  #persist() {
    const prefs = { enabled: this.#state.enabled, owner: this.#owner };
    this.#writes = this.#writes.catch(() => {}).then(() => savePrivateJson(this.#options.directory, "runner.json", prefs));
    return this.#writes;
  }

  async restore(): Promise<void> {
    const prefs = await jsonFile(join(this.#options.directory, "runner.json")) as { enabled?: boolean; owner?: Pick<OpenmaConnection, "userId" | "baseUrl"> } | null;
    if (prefs?.enabled && prefs.owner) {
      let connection: OpenmaConnection;
      try { connection = this.#options.connection(); } catch { return; }
      if (connection.userId === prefs.owner.userId && connection.baseUrl === prefs.owner.baseUrl) {
        await this.enable().catch((error: Error) => { this.#update({ message: error.message }); });
      }
    }
  }

  async #request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await (this.#options.fetchImpl ?? fetch)(url, {
      ...init, signal: init.signal ?? this.#operation?.signal,
      headers: { "content-type": "application/json", ...init.headers },
    });
    if (response.status === 401 || response.status === 403) throw new RunnerAuthorizationError("Runner authorization expired. Reconnect this machine.");
    if (!response.ok) throw new Error(`OpenMA runner request failed (${response.status})`);
    return await response.json() as T;
  }

  #verifyIdentity(me: RuntimeIdentity, credentials: Partial<RunnerCredentials>, workspaceId: string): void {
    if (me.runtime?.id !== credentials.runtimeId || !me.runtime?.machine_id
      || (credentials.machineId && me.runtime.machine_id !== credentials.machineId)) {
      throw new RunnerAuthorizationError("Runner machine identity does not match its saved credentials");
    }
    if (!me.tenants.some((tenant) => tenant.id === workspaceId)) throw new RunnerAuthorizationError("This workspace is not authorized for the runner. Refresh its authorization.");
  }

  #observe(credentials: Partial<RunnerCredentials>, connection: OpenmaConnection): void {
    const observation = new AbortController();
    this.#observation = observation;
    const current = () => this.#observation === observation && !observation.signal.aborted;
    const poll = async () => {
      try {
        const scope = this.#options.connection();
        if (scope.userId !== connection.userId || scope.baseUrl !== connection.baseUrl) { this.stop(); return; }
        const me = await this.#request<RuntimeIdentity>(`${connection.baseUrl}/agents/runtime/me`, {
          signal: AbortSignal.any([observation.signal, AbortSignal.timeout(10_000)]),
          headers: { authorization: `Bearer ${credentials.token}` },
        });
        if (!current()) return;
        this.#verifyIdentity(me, credentials, this.#options.connection().workspaceId);
        // The OpenMA service remains the source of connection state. An outage
        // never grants this observer the right to start a replacement daemon.
        this.#update({ status: runtimeOnline(me) ? "online" : "offline", message: undefined });
      } catch (error) {
        if (current()) {
          if (error instanceof RunnerAuthorizationError) { this.stop(); this.#update({ status: "expired", message: error.message }); }
          else this.#update({ status: "offline", message: error instanceof Error ? error.message : "Runner connection interrupted" });
        }
      } finally {
        if (current()) {
          this.#poll = setTimeout(() => { this.#poll = null; void poll(); }, 10_000);
          this.#poll.unref?.();
        }
      }
    };
    this.#poll = setTimeout(() => { this.#poll = null; void poll(); }, 10_000);
    this.#poll.unref?.();
  }

  async #daemon(): Promise<{ pid: number; running: boolean } | null> {
    if (this.#options.inspectDaemon) return this.#options.inspectDaemon();
    try {
      const pid = Number((await readFile(join(this.#options.bridgeDirectory, "daemon.pid"), "utf8")).trim());
      if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return null;
      process.kill(pid, 0);
      return { pid, running: true };
    } catch { return null; }
  }

  async enable(): Promise<void> {
    if (this.#options.connection().canManageRuntimes === false) throw new Error("Connecting a local runner requires an OpenMA user API key");
    if (this.#options.connection().provider) throw new Error("Local runners require an OpenMA connection");
    if (this.#operation) throw new Error("Runner connection is already in progress");
    if (this.#state.enabled) return;
    const connection = this.#options.connection();
    const operation = new AbortController(); this.#operation = operation;
    const check = () => {
      if (operation.signal.aborted) throw new Error("Runner connection cancelled");
      const current = this.#options.connection();
      if (current.userId !== connection.userId || current.baseUrl !== connection.baseUrl || current.workspaceId !== connection.workspaceId) throw new Error("OpenMA account or workspace changed");
    };
    try {
      const daemon = await this.#daemon(); check();
      let credentials = await jsonFile(join(this.#options.bridgeDirectory, "credentials.json")) as (Partial<RunnerCredentials> & { agentApiKey?: string }) | null;
      check();
      if (credentials && (!credentials.serverUrl || openmaBaseUrl(credentials.serverUrl) !== connection.baseUrl)) {
        throw new Error("This runner is registered to another OpenMA server. Choose its server or a separate OMA profile.");
      }
      if (credentials?.token && credentials.runtimeId) {
        // User credentials prove ownership; the machine bearer independently
        // proves this registration is still valid before any socket is opened.
        const owned = await this.#request<{ runtimes: Array<{ id: string }> }>(`${connection.baseUrl}/v1/oma/runtimes`, { headers: { "x-api-key": connection.apiKey, "x-active-tenant": connection.workspaceId } });
        if (!owned.runtimes.some((runtime) => runtime.id === credentials!.runtimeId)) throw new Error("This runner belongs to another account or its registration was revoked");
        const me = await this.#request<RuntimeIdentity>(`${connection.baseUrl}/agents/runtime/me`, { headers: { authorization: `Bearer ${credentials.token}` } });
        check();
        this.#verifyIdentity(me, credentials, connection.workspaceId);
        if (runtimeOnline(me) || daemon?.running) {
          this.#owner = { userId: connection.userId, baseUrl: connection.baseUrl };
          this.#update({ enabled: true, hosting: "external", status: runtimeOnline(me) ? "online" : "offline", runtimeId: credentials.runtimeId, machineId: me.runtime.machine_id, message: undefined });
          this.#observe(credentials, connection);
          check(); await this.#persist();
          return;
        }
        if (credentials.v !== 2) {
          const refreshed = await this.#request<{ tenants: Array<{ id: string; name: string; agent_api_key: string }> }>(`${connection.baseUrl}/agents/runtime/${encodeURIComponent(credentials.runtimeId)}/refresh`, { method: "POST", headers: { authorization: `Bearer ${credentials.token}` } });
          credentials = { ...credentials, v: 2, machineId: me.runtime.machine_id, tenants: refreshed.tenants.map((t) => ({ id: t.id, name: t.name, agentApiKey: t.agent_api_key })) };
          check(); await savePrivateJson(this.#options.bridgeDirectory, "credentials.json", credentials);
        }
      } else {
        if (daemon?.running) {
          this.#update({ hosting: null, status: "occupied", message: "An existing daemon could not be verified. Check its OpenMA profile and credentials before starting another host." });
          throw new Error(this.#state.message);
        }
        this.#update({ status: "registering", message: undefined });
        const authorization = connection.authMethod === "api_key" ? await (async () => {
          const state = randomUUID();
          const result = await this.#request<{ code: string }>(`${connection.baseUrl}/v1/oma/runtimes/connect-runtime`, {
            method: "POST", headers: { "x-api-key": connection.apiKey, "x-active-tenant": connection.workspaceId }, body: JSON.stringify({ state }), signal: operation.signal,
          });
          if (!result.code) throw new Error("OpenMA did not return a runner authorization code");
          return { code: result.code, state };
        })() : await (this.#options.authorize ?? browserRuntimeAuthorization)({ baseUrl: connection.baseUrl, signal: operation.signal, openExternal: this.#options.openExternal ?? (async () => { throw new Error("Browser unavailable"); }) });
        const { code, state } = authorization;
        check();
        await mkdir(this.#options.bridgeDirectory, { recursive: true, mode: 0o700 });
        let machineId: string;
        try { machineId = (await readFile(join(this.#options.bridgeDirectory, "machine-id"), "utf8")).trim(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; machineId = randomUUID(); await writeFile(join(this.#options.bridgeDirectory, "machine-id"), machineId, { mode: 0o600, flag: "wx" }); }
        const exchanged = await this.#request<{ runtime_id: string; token: string; tenants: Array<{ id: string; name: string; agent_api_key: string }> }>(`${connection.baseUrl}/agents/runtime/exchange`, {
          method: "POST", body: JSON.stringify({ code, state, machine_id: machineId, hostname: hostname(), os: `${platform()}/${process.arch}`, version: this.#options.version ?? "backchat", multi_tenant: true }),
        });
        check();
        const tenant = exchanged.tenants?.find((t) => t.id === connection.workspaceId);
        if (!tenant?.agent_api_key || !exchanged.token || !exchanged.runtime_id) throw new Error("Runner authorization did not include the selected workspace");
        const me = await this.#request<{ user: { id: string }; tenant: { id: string } }>(`${connection.baseUrl}/v1/oma/me`, { headers: { "x-api-key": tenant.agent_api_key } });
        if (me.user?.id !== connection.userId || me.tenant?.id !== connection.workspaceId) throw new Error("Runner authorization belongs to a different account");
        credentials = { v: 2, serverUrl: connection.baseUrl, runtimeId: exchanged.runtime_id, token: exchanged.token, machineId, tenants: exchanged.tenants.map((t) => ({ id: t.id, name: t.name, agentApiKey: t.agent_api_key })) };
        check(); await savePrivateJson(this.#options.bridgeDirectory, "credentials.json", credentials);
      }
      check();
      if (!credentials.machineId || !credentials.token || !credentials.runtimeId || !Array.isArray(credentials.tenants)) throw new Error("Runner configuration is incomplete");
      this.#owner = { userId: connection.userId, baseUrl: connection.baseUrl };
      this.#update({ enabled: true, hosting: "backchat", status: "connecting", runtimeId: credentials.runtimeId, machineId: credentials.machineId, message: undefined });
      const registered = credentials as RunnerCredentials;
      let hostedOnline = false;
      this.#outbox?.close();
      this.#outbox = new OpenmaRunnerOutbox(join(this.#options.directory, "runner-outbox.db"), JSON.stringify([connection.baseUrl, connection.userId, registered.runtimeId]));
      this.#bridge = (this.#options.createBridge ?? ((deps) => new OmaBridgeClient(deps)))({
        credentials: registered,
        outbox: this.#outbox,
        host: this.#options.host, detectAgents: this.#options.detectAgents, version: this.#options.version,
        resolveWorkspace: async (sessionId, workspaceId, agentId) => {
          const tenant = registered.tenants.find((t) => t.id === workspaceId);
          if (!tenant) throw new Error("Session workspace is not authorized for this runner");
          const scope = { baseUrl: connection.baseUrl, userId: connection.userId, workspaceId };
          const client = new OpenManagedCloudRuntimeClient({
            ...scope, apiKey: tenant.agentApiKey, fetchImpl: this.#options.fetchImpl,
            onUnauthorized: () => { this.stop(); this.#update({ status: "expired", message: "Refresh this runner's workspace authorization" }); },
          });
          const session = await client.request(() => client.sdk.beta.sessions.retrieve(sessionId));
          if (session.id !== sessionId || !session.environment_id) throw new Error("OpenMA task environment is unavailable");
          if (!this.#options.resolveProject) throw new Error("This environment has no linked project on this runner");
          return this.#options.resolveProject(scope, registered.runtimeId, session.environment_id, sessionId, agentId);
        },
        onConnectionState: (status) => {
          if (status === "stopped") return;
          if (status === "online") hostedOnline = true;
          if (status === "occupied" && !hostedOnline) {
            // Another authenticated host won the service's execution lease
            // after discovery. This attempted host has admitted no sessions.
            // An already-running host must never transfer ownership this way.
            this.#bridge?.stop(); this.#bridge = null;
            this.#outbox?.close(); this.#outbox = null;
            this.#update({ enabled: true, hosting: "external", status: "connecting", message: undefined });
            this.#observe(registered, connection);
            return;
          }
          this.#update({ status, ...(status === "occupied" || status === "expired" ? { enabled: false, hosting: null } : {}) });
        },
      });
      await this.#bridge.connect();
      check(); await this.#persist();
    } catch (error) {
      if (this.#state.status !== "occupied") this.#update({ enabled: false, hosting: null, status: operation.signal.aborted ? "disabled" : "error", message: error instanceof Error ? error.message : "Runner connection failed" });
      this.#observation?.abort(); this.#observation = null;
      if (this.#poll !== null) clearTimeout(this.#poll); this.#poll = null;
      this.#bridge?.stop(); this.#bridge = null;
      this.#outbox?.close(); this.#outbox = null;
      throw error;
    } finally { if (this.#operation === operation) this.#operation = null; }
  }

  resume(): void { this.#bridge?.resume?.(); }

  async disable(): Promise<void> { this.stop(); await this.#persist(); }
  stop(): void {
    this.#observation?.abort(); this.#observation = null;
    if (this.#poll !== null) clearTimeout(this.#poll); this.#poll = null;
    this.#operation?.abort(); this.#bridge?.stop(); this.#bridge = null;
    this.#outbox?.close(); this.#outbox = null;
    this.#update({ enabled: false, hosting: null, status: "disabled", message: undefined });
  }
  handleSessionEvent(event: SessionEventOut): void { this.#bridge?.handleSessionEvent(event); }
  requestPermission(sessionId: string, params: unknown) { return this.#bridge?.requestPermission?.(sessionId, params) ?? Promise.resolve({ outcome: { outcome: "cancelled" as const } }); }
  cancelPendingFor(sessionId: string): void { this.#bridge?.cancelPendingFor?.(sessionId); }
}
