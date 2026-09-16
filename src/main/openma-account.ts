import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OpenmaAccountState, OpenmaScope } from "../shared/openma.js";

const DEFAULT_ORIGIN = "https://app.openma.dev";
interface CallbackToken { tenant_id: string; tenant_name: string; role: string; token: string; key_id: string }
interface AuthorizationResult { tokens: CallbackToken[]; user: string }
interface AuthorizationOptions {
  baseUrl: string;
  signal: AbortSignal;
  openExternal: (url: string) => Promise<void>;
  timeoutMs?: number;
}
interface Credentials {
  version: 2;
  base_url: string;
  user: NonNullable<OpenmaAccountState["user"]>;
  active_tenant_id: string | null;
  tenants: Record<string, { name: string; role: string; token: string; key_id: string; created_at: string }>;
}
export interface OpenmaConnection { baseUrl: string; workspaceId: string; apiKey: string; userId: string }
interface AccountOptions {
  directory: string;
  fetch?: typeof fetch;
  authorize?: (options: AuthorizationOptions) => Promise<AuthorizationResult>;
  openExternal?: AuthorizationOptions["openExternal"];
  onChange?: (state: OpenmaAccountState) => void;
}

export function openmaBaseUrl(value: string): string {
  const url = new URL(value || DEFAULT_ORIGIN);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Enter an OpenMA HTTP(S) server address without credentials or query parameters");
  }
  if (url.origin === "https://openma.dev") url.hostname = "app.openma.dev";
  return url.href.replace(/\/$/, "");
}

function parseTokens(params: URLSearchParams): AuthorizationResult {
  let tokens: unknown;
  try {
    tokens = params.has("tokens")
      ? JSON.parse(Buffer.from(params.get("tokens")!, "base64").toString("utf8"))
      : [{ tenant_id: params.get("tenant"), tenant_name: "", role: "", token: params.get("token"), key_id: params.get("key_id") }];
  } catch { throw new Error("Invalid login callback payload"); }
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > 100 || tokens.some((t) =>
    !t || ["tenant_id", "token", "key_id"].some((key) => typeof t[key] !== "string" || !t[key])
  ) || new Set(tokens.map((t) => t.tenant_id)).size !== tokens.length) {
    throw new Error("Incomplete login callback");
  }
  return { tokens: tokens as CallbackToken[], user: params.get("user") ?? "" };
}

/** Uses oma auth login's public handoff. Bind before opening the browser. */
export function browserAuthorization(options: AuthorizationOptions): Promise<AuthorizationResult> {
  return browserHandoff(options, "/cli/login", "callback", parseTokens);
}

export function browserRuntimeAuthorization(options: AuthorizationOptions): Promise<{ code: string; state: string }> {
  return browserHandoff(options, "/connect-runtime", "cb", (params) => {
    const code = params.get("code");
    if (!code) throw new Error("Runner authorization code missing");
    return { code, state: params.get("state")! };
  });
}

async function browserHandoff<T>(options: AuthorizationOptions, route: string, callbackParam: string, parse: (params: URLSearchParams) => T): Promise<T> {
  if (options.signal.aborted) throw new Error("Login cancelled");
  const baseUrl = openmaBaseUrl(options.baseUrl);
  const state = randomBytes(24).toString("hex");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      server.close();
      server.closeIdleConnections();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error("Login cancelled"));
    const server = createServer({ maxHeaderSize: 128 * 1024 }, (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback") { res.writeHead(404).end(); return; }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      try {
        if (url.searchParams.get("state") !== state) throw new Error("Login state mismatch");
        if (url.searchParams.has("error")) throw new Error("Login cancelled");
        const result = parse(url.searchParams);
        res.writeHead(200).end("Signed in. You can close this tab and return to Backchat.");
        finish(undefined, result);
      } catch (error) {
        res.writeHead(400).end("Login failed. Return to Backchat and try again.");
        finish(error as Error);
      }
    });
    const timeout = setTimeout(() => finish(new Error("Login timed out. Please try again.")), options.timeoutMs ?? 300_000);
    options.signal.addEventListener("abort", abort, { once: true });
    server.on("error", () => finish(new Error("Could not start the login callback listener")));
    server.listen(0, "127.0.0.1", () => {
      if (settled) { server.close(); return; }
      const address = server.address();
      if (!address || typeof address === "string") { finish(new Error("Login callback unavailable")); return; }
      const params = new URLSearchParams({ [callbackParam]: `http://127.0.0.1:${address.port}/callback`, state, hostname: hostname() });
      void options.openExternal(`${baseUrl}${route}?${params}`).catch(() => finish(new Error("Could not open the login browser")));
    });
  });
}

export class OpenmaAccount {
  #credentials: Credentials | null = null;
  #pending: AbortController | null = null;
  #expired = new Set<string>();
  #generation = 0;
  #disk: Promise<void> = Promise.resolve();
  #options: AccountOptions;
  #listeners = new Set<(state: OpenmaAccountState) => void>();
  constructor(options: AccountOptions) { this.#options = options; }

  state(): OpenmaAccountState {
    const creds = this.#credentials;
    return {
      status: this.#pending ? "signing_in" : !creds ? "signed_out" : this.#expired.has(creds.active_tenant_id ?? "") ? "expired" : "signed_in",
      baseUrl: creds?.base_url ?? DEFAULT_ORIGIN,
      user: creds ? { id: creds.user.id, email: creds.user.email, name: creds.user.name } : null,
      workspaces: Object.entries(creds?.tenants ?? {}).map(([id, t]) => ({ id, name: t.name, role: t.role, expired: this.#expired.has(id) })),
      activeWorkspaceId: creds?.active_tenant_id ?? null,
    };
  }

  subscribe(listener: (state: OpenmaAccountState) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  #notify() { const state = this.state(); this.#options.onChange?.(state); for (const listener of this.#listeners) listener(state); }
  #persist(credentials: Credentials | null): Promise<void> {
    // Serialize writes with logout so a late login cannot recreate deleted credentials.
    const value = credentials ? JSON.stringify(credentials) : null;
    const operation = this.#disk.catch(() => {}).then(async () => {
      const directory = this.#options.directory;
      const file = join(directory, "account.json");
      if (value === null) { await rm(file, { force: true }); return; }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const temporary = `${file}.tmp`;
      await writeFile(temporary, value, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, file);
    });
    this.#disk = operation;
    return operation;
  }

  async restore(): Promise<void> {
    try {
      const c = JSON.parse(await readFile(join(this.#options.directory, "account.json"), "utf8")) as Credentials;
      if (c.version !== 2 || !c.user?.id || !c.tenants || Array.isArray(c.tenants)) return;
      for (const t of Object.values(c.tenants)) if (!t || typeof t.token !== "string" || !t.token || typeof t.key_id !== "string") return;
      c.base_url = openmaBaseUrl(c.base_url);
      if (!c.active_tenant_id || !Object.hasOwn(c.tenants, c.active_tenant_id)) c.active_tenant_id = null;
      this.#credentials = c;
      this.#notify();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" && !(e instanceof SyntaxError)) throw new Error("Could not read the saved OpenMA account");
    }
  }

  async login(server: string): Promise<void> {
    const baseUrl = openmaBaseUrl(server);
    this.cancelLogin();
    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#pending = controller;
    this.#notify();
    const check = () => { if (generation !== this.#generation || controller.signal.aborted) throw new Error("Login cancelled"); };
    try {
      const result = await (this.#options.authorize ?? browserAuthorization)({
        baseUrl, signal: controller.signal,
        openExternal: this.#options.openExternal ?? (async () => { throw new Error("Browser unavailable"); }),
      });
      check();
      const tenants: Credentials["tenants"] = Object.create(null);
      let user: Credentials["user"] | null = null;
      for (const t of result.tokens) {
        const response = await (this.#options.fetch ?? fetch)(`${baseUrl}/v1/oma/me`, {
          headers: { "x-api-key": t.token }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`OpenMA login verification failed (${response.status})`);
        const me = await response.json() as { user: Credentials["user"] | null; tenant: { id: string }; tenants: Array<{ id: string; name: string; role: string }> };
        check();
        if (!me.user?.id || me.tenant?.id !== t.tenant_id || (user && user.id !== me.user.id) || (result.user && result.user !== me.user.id)) {
          throw new Error("Login workspace or account identity mismatch");
        }
        const membership = me.tenants?.find((m) => m.id === t.tenant_id);
        if (!membership) throw new Error("Login workspace membership missing");
        user = { id: me.user.id, email: me.user.email, name: me.user.name ?? null };
        tenants[t.tenant_id] = { name: membership.name, role: membership.role, token: t.token, key_id: t.key_id, created_at: new Date().toISOString() };
      }
      if (!user || !Object.keys(tenants).length) throw new Error("No authorized workspace");
      const prior = this.#credentials;
      const previousId = prior?.base_url === baseUrl && prior.user.id === user.id ? prior.active_tenant_id : null;
      const next: Credentials = { version: 2, base_url: baseUrl, user, tenants, active_tenant_id:
        previousId && Object.hasOwn(tenants, previousId) ? previousId : Object.keys(tenants).length === 1 ? Object.keys(tenants)[0]! : null };
      check();
      await this.#persist(next);
      check();
      this.#credentials = next;
      this.#expired.clear();
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Login cancelled");
      throw error;
    } finally {
      if (generation === this.#generation) { this.#pending = null; this.#notify(); }
    }
  }

  cancelLogin(): void { this.#generation++; this.#pending?.abort(); this.#pending = null; this.#notify(); }
  async logout(): Promise<void> {
    this.cancelLogin();
    this.#credentials = null;
    this.#expired.clear();
    this.#notify();
    await this.#persist(null);
  }
  async selectWorkspace(id: string): Promise<void> {
    if (!this.#credentials || !Object.hasOwn(this.#credentials.tenants, id)) throw new Error("Unknown workspace");
    this.#credentials.active_tenant_id = id;
    this.#notify();
    await this.#persist(this.#credentials);
  }
  connection(scope?: OpenmaScope): OpenmaConnection {
    const c = this.#credentials;
    if (!c || this.#pending) throw new Error("OpenMA login required");
    const workspaceId = scope ? scope.workspaceId : c.active_tenant_id;
    if (!workspaceId) throw new Error("Choose an OpenMA workspace");
    if (scope && (scope.baseUrl !== c.base_url || scope.userId !== c.user.id)) throw new Error("OpenMA account changed");
    if (!Object.hasOwn(c.tenants, workspaceId)) throw new Error("Unknown OpenMA workspace");
    if (this.#expired.has(workspaceId)) throw new Error("OpenMA login required for this workspace");
    return { baseUrl: c.base_url, workspaceId, apiKey: c.tenants[workspaceId]!.token, userId: c.user.id };
  }
  connections(): OpenmaConnection[] {
    const c = this.#credentials;
    if (!c || this.#pending) return [];
    return Object.keys(c.tenants).filter((id) => !this.#expired.has(id)).map((workspaceId) =>
      this.connection({ baseUrl: c.base_url, userId: c.user.id, workspaceId }));
  }
  assertConnection(connection: OpenmaConnection): void {
    if (this.connection(connection).apiKey !== connection.apiKey) throw new Error("OpenMA credentials changed");
  }
  invalidate(connection: OpenmaConnection): void {
    const c = this.#credentials;
    if (c?.base_url === connection.baseUrl && c.tenants[connection.workspaceId]?.token === connection.apiKey) {
      this.#expired.add(connection.workspaceId); this.#notify();
    }
  }
}
