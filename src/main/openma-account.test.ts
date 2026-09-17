import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenmaAccount, browserAuthorization, browserRuntimeAuthorization } from "./openma-account.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
async function root() { const p = await mkdtemp(join(tmpdir(), "backchat-account-")); roots.push(p); return p; }
const tokens = [
  { tenant_id: "a", tenant_name: "Workspace A", role: "owner", token: "secret-a", key_id: "key-a" },
  { tenant_id: "b", tenant_name: "Workspace B", role: "member", token: "secret-b", key_id: "key-b" },
];
const identityFetch: typeof fetch = async (_url, init) => {
  const token = new Headers(init?.headers).get("x-api-key");
  const id = token === "secret-b" ? "b" : "a";
  return Response.json({ user: { id: "user", email: "user@example.com", name: "User" }, tenant: { id }, tenants: tokens.map((t) => ({ id: t.tenant_id, name: t.tenant_name, role: t.role })) });
};

describe("desktop account isolation", () => {
  it("projects only public identity fields even if the server adds private fields", async () => {
    const account = new OpenmaAccount({ directory: await root(), authorize: async () => ({ tokens: tokens.slice(0, 1), user: "user" }),
      fetch: async () => Response.json({ user: { id: "user", email: "user@example.com", name: "User", internal_token: "private" }, tenant: { id: "a" }, tenants: [{ id: "a", name: "A", role: "owner" }] }),
    });
    await account.login("https://app.openma.dev");
    expect(account.state().user).toEqual({ id: "user", email: "user@example.com", name: "User" });
  });
  it("requires a workspace choice, keeps secrets out of public state, and restores selection", async () => {
    const directory = await root();
    const account = new OpenmaAccount({ directory, fetch: identityFetch, authorize: async () => ({ tokens, user: "user" }) });
    await account.login("https://app.openma.dev");
    expect(account.state().activeWorkspaceId).toBeNull();
    expect(account.state().workspaces.map((w: { id: string }) => w.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(account.state())).not.toContain("secret-");
    expect(() => account.connection()).toThrow(/workspace/i);
    await account.selectWorkspace("b");
    expect(account.connection()).toMatchObject({ apiKey: "secret-b", workspaceId: "b" });
    const restored = new OpenmaAccount({ directory, fetch: identityFetch });
    await restored.restore();
    expect(restored.state().activeWorkspaceId).toBe("b");
    expect((await stat(join(directory, "account.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    await expect(restored.selectWorkspace("unknown")).rejects.toThrow(/workspace/i);
    expect(restored.connection().apiKey).toBe("secret-b");
    await restored.logout();
    expect(restored.state().status).toBe("signed_out");
    await expect(readFile(join(directory, "account.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("automatically selects a sole authorized workspace and marks revoked credentials expired", async () => {
    const account = new OpenmaAccount({ directory: await root(), fetch: identityFetch, authorize: async () => ({ tokens: tokens.slice(0, 1), user: "user" }) });
    await account.login("https://app.openma.dev");
    expect(account.state().activeWorkspaceId).toBe("a");
    account.invalidate(account.connection());
    expect(account.state().status).toBe("expired");
    expect(() => account.connection()).toThrow(/login/i);
  });

  it("does not resurrect an account when logout races browser authorization", async () => {
    let resolve!: (value: { tokens: typeof tokens; user: string }) => void;
    const pending = new Promise<{ tokens: typeof tokens; user: string }>((r) => { resolve = r; });
    const account = new OpenmaAccount({ directory: await root(), fetch: identityFetch, authorize: async () => pending });
    const login = account.login("https://app.openma.dev");
    await account.logout();
    resolve({ tokens, user: "user" });
    await expect(login).rejects.toThrow(/cancel/i);
    expect(account.state().status).toBe("signed_out");
  });

  it("does not reuse credentials across servers or accept a mismatched workspace identity", async () => {
    const directory = await root();
    const account = new OpenmaAccount({ directory, fetch: identityFetch, authorize: async () => ({ tokens: tokens.slice(0, 1), user: "user" }) });
    await account.login("https://one.example");
    await account.login("https://two.example");
    expect(account.connection().baseUrl).toBe("https://two.example");
    const invalid = new OpenmaAccount({ directory: await root(), fetch: async () => Response.json({ user: { id: "user" }, tenant: { id: "wrong" }, tenants: [] }), authorize: async () => ({ tokens: tokens.slice(0, 1), user: "user" }) });
    await expect(invalid.login("https://app.openma.dev")).rejects.toThrow(/workspace/i);
    expect(invalid.state().status).toBe("signed_out");
  });
});

describe("browser login handoff", () => {
  it("authorizes runner registration through its separate browser flow", async () => {
    const result = await browserRuntimeAuthorization({ baseUrl: "https://app.openma.dev", signal: new AbortController().signal, openExternal: async (url: string) => {
      const login = new URL(url);
      expect(login.pathname).toBe("/connect-runtime");
      const callback = new URL(login.searchParams.get("cb")!);
      callback.searchParams.set("state", login.searchParams.get("state")!);
      callback.searchParams.set("code", "one-time-code");
      await fetch(callback);
    } });
    expect(result.code).toBe("one-time-code");
    expect(result.state.length).toBeGreaterThan(20);
  });
  it("opens the existing login route and accepts a matching loopback callback", async () => {
    const result = await browserAuthorization({ baseUrl: "https://app.openma.dev", signal: new AbortController().signal, openExternal: async (url: string) => {
      const login = new URL(url);
      expect(login.pathname).toBe("/cli/login");
      const callback = new URL(login.searchParams.get("callback")!);
      expect(callback.hostname).toBe("127.0.0.1");
      callback.searchParams.set("state", login.searchParams.get("state")!);
      callback.searchParams.set("tokens", Buffer.from(JSON.stringify(tokens)).toString("base64"));
      callback.searchParams.set("user", "user");
      expect((await fetch(callback)).status).toBe(200);
    } });
    expect(result.tokens).toEqual(tokens);
  });

  it("rejects a forged state before accepting credentials", async () => {
    await expect(browserAuthorization({ baseUrl: "https://app.openma.dev", signal: new AbortController().signal, openExternal: async (url: string) => {
      const callback = new URL(new URL(url).searchParams.get("callback")!);
      callback.searchParams.set("state", "forged");
      callback.searchParams.set("tokens", Buffer.from(JSON.stringify(tokens)).toString("base64"));
      await fetch(callback);
    } })).rejects.toThrow(/state/i);
  });

  it("closes the loopback listener when cancelled", async () => {
    const controller = new AbortController();
    let callback = "";
    await expect(browserAuthorization({ baseUrl: "https://app.openma.dev", signal: controller.signal, openExternal: async (url: string) => {
      callback = new URL(url).searchParams.get("callback")!;
      controller.abort();
    } })).rejects.toThrow(/cancel/i);
    await expect(fetch(callback)).rejects.toThrow();
  });
});


describe("direct managed agent credentials", () => {
  it("connects without OpenMA identity endpoints, restores credentials, and isolates API protocols", async () => {
    const directory = await root();
    const account = new OpenmaAccount({ directory, fetch: async () => { throw new Error("OpenMA identity must not be queried"); } });
    await account.connectDirect({ provider: "claude-managed", baseUrl: "https://agents.example.test/", apiKey: "third-party-secret", name: "My Claude" });
    expect(account.connection()).toMatchObject({ provider: "claude-managed", baseUrl: "https://agents.example.test", apiKey: "third-party-secret" });
    expect(account.state()).toMatchObject({ status: "signed_in", provider: "claude-managed" });
    expect(JSON.stringify(account.state())).not.toContain("third-party-secret");
    const scope = account.connection();
    const restored = new OpenmaAccount({ directory });
    await restored.restore();
    expect(restored.connection()).toEqual(scope);
    await account.connectDirect({ provider: "openai-agents", baseUrl: "https://agents.example.test", apiKey: "another-secret", name: "My OpenAI" });
    expect(account.connection(scope)).toEqual(scope);
    expect(account.state().workspaces).toHaveLength(2);
    expect((await stat(join(directory, "account.json"))).mode & 0o777).toBe(0o600);
  });
  it("rejects invalid providers and keys without replacing an existing connection", async () => {
    const account = new OpenmaAccount({ directory: await root() });
    await expect(account.connectDirect({ provider: "responses" as never, baseUrl: "https://example.test", apiKey: "key", name: "Test" })).rejects.toThrow();
    await expect(account.connectDirect({ provider: "claude-managed", baseUrl: "https://example.test", apiKey: "  ", name: "Test" })).rejects.toThrow();
    expect(account.state().status).toBe("signed_out");
  });
});

it("keeps direct tenants alongside browser-authenticated workspaces and removes only the selected direct connection", async () => {
  const account = new OpenmaAccount({ directory: await root(), fetch: identityFetch, authorize: async () => ({ tokens, user: "user" }) });
  await account.connectDirect({ provider: "openai-agents", baseUrl: "https://third.test/v1", apiKey: "direct-key", name: "External" });
  const direct = account.connection();
  await account.login("https://app.openma.dev");
  expect(account.state().workspaces.map(w => w.name)).toContain("External");
  expect(account.connection(direct)).toEqual(direct);
  await account.selectWorkspace("a");
  expect(account.connection().apiKey).toBe("secret-a");
  await account.removeDirect(direct.workspaceId);
  expect(account.state().workspaces.map(w => w.id)).toEqual(["a", "b"]);
  expect(() => account.connection(direct)).toThrow();
});
it("accepts just protocol, key and base URL, using the hostname as tenant name", async () => {
  const account = new OpenmaAccount({ directory: await root() });
  await account.connectDirect({ provider: "claude-managed", baseUrl: "https://agents.example.test", apiKey: "key" });
  expect(account.state().workspaces[0]!.name).toBe("agents.example.test");
});
it("signing out of OpenMA keeps explicitly configured third-party tenants", async () => {
  const account = new OpenmaAccount({ directory: await root(), fetch: identityFetch, authorize: async () => ({ tokens, user: "user" }) });
  await account.login("https://app.openma.dev");
  await account.connectDirect({ provider: "claude-managed", baseUrl: "https://third.test", apiKey: "external" });
  const connection = account.connection();
  await account.logout();
  expect(account.state().workspaces).toHaveLength(1);
  expect(account.connection(connection)).toEqual(connection);
});
it("uses an OpenMA API key to discover its real tenant without browser login or granting other memberships", async () => {
  const requests: string[] = [];
  const account = new OpenmaAccount({ directory: await root(), fetch: async (url, init) => {
    requests.push(String(url)); expect(new Headers(init?.headers).get("x-api-key")).toBe("oma-user-key");
    return Response.json({ user: { id: "user", name: "User", email: "u@test" }, tenant: { id: "a", name: "Team A" }, tenants: [{ id: "a", name: "Team A", role: "owner" }, { id: "b", name: "Team B", role: "owner" }] });
  }, authorize: async () => { throw new Error("Must not open browser"); } });
  await account.connectDirect({ provider: "openma", baseUrl: "https://openma.example.test/v1", apiKey: "oma-user-key" });
  expect(requests).toEqual(["https://openma.example.test/v1/oma/me"]);
  expect(account.connection()).toMatchObject({ baseUrl: "https://openma.example.test", workspaceId: "a", userId: "user", authMethod: "api_key", apiKey: "oma-user-key" });
  expect(account.state().workspaces).toHaveLength(1);
  expect(account.state().workspaces[0]).toMatchObject({ id: "a", name: "Team A" });
});
it("accepts a tenant-only OpenMA key for cloud use without claiming runner ownership", async () => {
  const account = new OpenmaAccount({ directory: await root(), fetch: async () => Response.json({ user: null, tenant: { id: "team", name: "Team" }, tenants: [] }) });
  await account.connectDirect({ provider: "openma", baseUrl: "https://openma.example.test", apiKey: "service-key" });
  expect(account.connection()).toMatchObject({ workspaceId: "team", authMethod: "api_key", canManageRuntimes: false });
  expect(account.state().canManageRuntimes).toBe(false);
});


it("does not persist a direct connection cancelled during credential derivation", async () => {
  const directory = await root();
  const account = new OpenmaAccount({ directory });
  const connecting = account.connectDirect({ provider: "openai-agents", baseUrl: "https://third.test/v1", apiKey: "cancelled-key" });
  const rejected = expect(connecting).rejects.toThrow(/cancel/i);
  await account.logout();
  await rejected;
  const restored = new OpenmaAccount({ directory });
  await restored.restore();
  expect(restored.state().status).toBe("signed_out");
});

it("reuses the same direct identity but isolates a rotated key on the same endpoint", async () => {
  const account = new OpenmaAccount({ directory: await root() });
  const input = { provider: "openai-agents" as const, baseUrl: "https://third.test/v1", apiKey: "first-key" };
  await account.connectDirect(input);
  const first = account.connection();
  await account.connectDirect(input);
  expect(account.connection()).toEqual(first);
  expect(account.state().workspaces).toHaveLength(1);
  await account.connectDirect({ ...input, apiKey: "rotated-key" });
  expect(account.connection().workspaceId).not.toBe(first.workspaceId);
  expect(account.connection(first)).toEqual(first);
});
