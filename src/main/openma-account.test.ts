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
