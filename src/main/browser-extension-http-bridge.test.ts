import { describe, expect, it } from "vitest";

import { createChromeExtensionHttpBridge } from "./browser-extension-http-bridge.js";

describe("createChromeExtensionHttpBridge", () => {
  it("answers Chrome extension preflight requests for localhost bridge access", async () => {
    const server = await createChromeExtensionHttpBridge({ preferredPort: 0 });
    try {
      const response = await fetch(`${server.url}/register`, {
        method: "OPTIONS",
        headers: {
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
          origin: "chrome-extension://extension-id",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-private-network")).toBe("true");
    } finally {
      await server.close();
    }
  });

  it("registers an extension and delivers queued commands over localhost HTTP", async () => {
    const server = await createChromeExtensionHttpBridge({ preferredPort: 0 });
    try {
      await expect(server.bridge.sendCommand({ id: "cmd-before", type: "tabs.list" }))
        .rejects.toThrow("Chrome extension bridge is not connected");

      await expect(postJson(`${server.url}/register`, {
        protocolVersion: 1,
        type: "extension.register",
        extensionId: "ext-1",
        extensionVersion: "0.1.0",
        instanceId: "instance-1",
        profileName: "Default",
      })).resolves.toEqual({ ok: true });

      const command = server.bridge.sendCommand({ id: "cmd-1", type: "tabs.list" });
      await expect(fetch(`${server.url}/commands/next?instanceId=instance-1`).then((r) => r.json()))
        .resolves.toEqual({ id: "cmd-1", type: "tabs.list" });
      await postJson(`${server.url}/commands/result`, {
        instanceId: "instance-1",
        id: "cmd-1",
        ok: true,
        result: [{ id: "7", title: "Probe", url: "http://127.0.0.1:5173/" }],
      });

      await expect(command).resolves.toEqual([
        { id: "7", title: "Probe", url: "http://127.0.0.1:5173/" },
      ]);
      expect(server.bridge.registration).toMatchObject({
        extensionId: "ext-1",
        instanceId: "instance-1",
      });
    } finally {
      await server.close();
    }
  });

  it("holds the extension command poll until a command is queued", async () => {
    const server = await createChromeExtensionHttpBridge({
      preferredPort: 0,
      commandLongPollMs: 1_000,
    });
    try {
      await postJson(`${server.url}/register`, {
        protocolVersion: 1,
        type: "extension.register",
        extensionId: "ext-1",
        extensionVersion: "0.1.0",
        instanceId: "instance-1",
      });

      const next = fetch(`${server.url}/commands/next?instanceId=instance-1`)
        .then((response) => response.json());
      await new Promise((resolve) => setTimeout(resolve, 25));

      const command = server.bridge.sendCommand({ id: "cmd-held", type: "tabs.list" });
      await expect(next).resolves.toEqual({ id: "cmd-held", type: "tabs.list" });
      await postJson(`${server.url}/commands/result`, {
        instanceId: "instance-1",
        id: "cmd-held",
        ok: true,
        result: [],
      });
      await expect(command).resolves.toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("tracks bridge health for command errors and timeouts", async () => {
    const server = await createChromeExtensionHttpBridge({
      preferredPort: 0,
      commandTimeoutMs: 25,
    });
    try {
      expect(server.bridge.health).toMatchObject({
        status: "disconnected",
        pendingCommandCount: 0,
        queuedCommandCount: 0,
      });
      await expect(server.bridge.sendCommand({ id: "cmd-before", type: "tabs.list" }))
        .rejects.toThrow("Chrome extension bridge is not connected");
      expect(server.bridge.health).toMatchObject({
        status: "disconnected",
        lastError: "Chrome extension bridge is not connected",
      });

      await postJson(`${server.url}/register`, {
        protocolVersion: 1,
        type: "extension.register",
        extensionId: "ext-1",
        extensionVersion: "0.1.0",
        instanceId: "instance-1",
      });
      expect(server.bridge.health).toMatchObject({
        status: "connected",
      });
      expect(server.bridge.health).not.toHaveProperty("lastError");

      const failedCommand = server.bridge.sendCommand({ id: "cmd-fail", type: "tabs.list" });
      const failedExpectation = expect(failedCommand).rejects.toThrow("extension failed");
      await expect(fetch(`${server.url}/commands/next?instanceId=instance-1`).then((r) => r.json()))
        .resolves.toEqual({ id: "cmd-fail", type: "tabs.list" });
      await postJson(`${server.url}/commands/result`, {
        instanceId: "instance-1",
        id: "cmd-fail",
        ok: false,
        error: "extension failed",
      });
      await failedExpectation;
      expect(server.bridge.health).toMatchObject({
        status: "command-error",
        lastCommandType: "tabs.list",
        lastError: "extension failed",
        pendingCommandCount: 0,
        queuedCommandCount: 0,
      });

      await expect(server.bridge.sendCommand({ id: "cmd-timeout", type: "tab.screenshot", tabId: "7" }))
        .rejects.toThrow("Chrome extension command timed out: tab.screenshot");
      expect(server.bridge.health).toMatchObject({
        status: "command-timeout",
        lastCommandType: "tab.screenshot",
        lastError: "Chrome extension command timed out: tab.screenshot",
        pendingCommandCount: 0,
        queuedCommandCount: 0,
      });
    } finally {
      await server.close();
    }
  });
});

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json();
}
