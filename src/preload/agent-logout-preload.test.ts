import { beforeAll, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => [{ id: "pi-acp" }]));
const exposed = vi.hoisted(() => new Map<string, unknown>());

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed.set(key, value);
    },
  },
  ipcRenderer: {
    invoke,
    on: vi.fn(() => undefined),
    removeListener: vi.fn(() => undefined),
  },
  webUtils: {
    getPathForFile: () => "",
  },
}));

describe("preload agent logout", () => {
  beforeAll(async () => {
    await import("./index.js");
  });

  it("invokes the ACP logout channel", async () => {
    const api = exposed.get("backchat") as {
      agentLogout: (input: { id: string; sessionId?: string }) => Promise<unknown>;
    };
    await expect(api.agentLogout({ id: "pi-acp", sessionId: "sess-1" })).resolves.toEqual([
      { id: "pi-acp" },
    ]);
    expect(invoke).toHaveBeenCalledWith("agent:logout", { id: "pi-acp", sessionId: "sess-1" });
  });
});
