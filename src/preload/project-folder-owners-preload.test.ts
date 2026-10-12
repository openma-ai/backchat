import { beforeAll, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => ({ "~/hilo": "proj-hilo" })));
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

describe("preload project folder owners", () => {
  beforeAll(async () => {
    await import("./index.js");
  });

  it("asks main which project owns each path", async () => {
    const api = exposed.get("backchat") as {
      projectFolderOwners: (input: { paths: string[] }) => Promise<Record<string, string>>;
    };
    await expect(api.projectFolderOwners({ paths: ["~/hilo"] })).resolves.toEqual({ "~/hilo": "proj-hilo" });
    expect(invoke).toHaveBeenCalledWith("projects:folder-owners", { paths: ["~/hilo"] });
  });
});
