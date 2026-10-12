import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => unknown>());

vi.hoisted(() => {
  process.env["BACKCHAT_TEST_HOOKS"] = "1";
  process.env["BACKCHAT_E2E_SKIP_AGENT_WARMUP"] = "1";
  process.env["BACKCHAT_DISABLE_CONTROL"] = "1";
  process.env["BACKCHAT_HOME"] = process.env["BACKCHAT_HOME"] ?? "/tmp";
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/tmp/backchat-app",
    getPath: () => "/tmp/backchat-app",
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  Notification: class Notification {
    static isSupported(): boolean {
      return false;
    }
    on(): void {}
    show(): void {}
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  shell: { openExternal: vi.fn(async () => undefined), openPath: vi.fn(async () => "") },
  session: { defaultSession: { on: vi.fn() } },
  webContents: { fromId: () => null, getAllWebContents: () => [] },
}));

import { InvokeChannel } from "../shared/ipc-channels.js";
import type { ProjectInfo } from "../shared/projects.js";
import { registerIpc } from "./ipc.js";
import { openSessionDb } from "./sql-store.js";

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`missing handler ${channel}`);
  return await handler({}, payload) as T;
}

describe("project registry IPC", () => {
  let dispose: (() => Promise<void>) | undefined;
  let home = "";

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "backchat-project-ipc-"));
    process.env["BACKCHAT_HOME"] = home;
    openSessionDb(join(home, "sessions.db"));
    const runtime = await registerIpc({
      registryCachePath: join(home, "registry.json"),
      probeCachePath: join(home, "probe.json"),
      acpBinDir: join(home, "bin"),
      acpInstallRoot: join(home, "acp"),
      scheduleDbPath: join(home, "schedules.sqlite"),
    });
    dispose = () => runtime.dispose();
  }, 30_000);

  afterAll(async () => {
    await dispose?.();
  });

  it("saves one project per folder and resolves recent-path variants to it", async () => {
    const repo = join(home, "hilo-coord-test");
    const link = join(home, "hilo-link");
    await mkdir(repo, { recursive: true });
    await symlink(repo, link);

    const first = await invoke<ProjectInfo>(InvokeChannel.ProjectSave, {
      project_id: "proj-first", name: "hilo-coord-test", source_folders: [repo], primary_folder: repo,
    });
    const again = await invoke<ProjectInfo>(InvokeChannel.ProjectSave, {
      project_id: "proj-again", name: "hilo-coord-test", source_folders: [`${link}/`], primary_folder: `${link}/`,
    });
    expect(again.id).toBe(first.id);
    const listed = await invoke<ProjectInfo[]>(InvokeChannel.ProjectsList);
    expect(listed.filter((project) => project.name === "hilo-coord-test")).toHaveLength(1);

    await expect(invoke(InvokeChannel.ProjectFolderOwners, { paths: [link, `${repo}/`, join(home, "scratch")] }))
      .resolves.toEqual({ [link]: first.id, [`${repo}/`]: first.id });
  });
});
