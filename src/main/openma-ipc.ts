import { BrowserWindow, ipcMain, shell, dialog, type WebContents } from "electron";
import { writeFile } from "node:fs/promises";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import { OpenmaAccount } from "./openma-account.js";
import type { OpenmaRunner } from "./openma-runner.js";
import type { OpenmaProjectService } from "./openma-project-service.js";
import type { OpenmaProjectBinding } from "../shared/openma.js";
import { OpenmaTasks } from "./openma-tasks.js";
import type { OpenmaExecutionTarget, OpenmaScope } from "../shared/openma.js";
import type { OpenmaTaskResponse, OpenmaTaskUpdate } from "../shared/openma.js";

function scope(value: unknown): OpenmaScope | undefined {
  if (value === undefined) return undefined;
  const scope = value as Partial<OpenmaScope> | null;
  if (!scope || ![scope.baseUrl, scope.userId, scope.workspaceId].every((v) => typeof v === "string" && v.length > 0 && v.length < 4096)) throw new Error("Invalid OpenMA workspace");
  return { baseUrl: scope.baseUrl!, userId: scope.userId!, workspaceId: scope.workspaceId! };
}

export function registerOpenmaTaskIpc(tasks: OpenmaTasks): void {
  const text = (value: unknown): string => { if (typeof value !== "string" || !value || value.length > 1_000_000) throw new Error("Invalid OpenMA task request"); return value; };
  const clients = new Map<number, Set<string>>();
  const ownerKey = (sender: WebContents, subscriptionId: unknown) => JSON.stringify([sender.id, text(subscriptionId)]);
  const own = (sender: WebContents, owner: string) => {
    let owners = clients.get(sender.id);
    if (!owners) {
      owners = new Set<string>(); clients.set(sender.id, owners);
      const release = () => { for (const key of owners!) tasks.releaseOwner(key); owners!.clear(); };
      sender.on("did-start-navigation", (details) => { if (details.isMainFrame && !details.isSameDocument) release(); });
      sender.on("render-process-gone", release);
      sender.once("destroyed", () => { release(); clients.delete(sender.id); });
    }
    owners.add(owner);
  };
  ipcMain.handle(InvokeChannel.OpenmaTasksList, (_event, value: unknown) => tasks.list(scope(value)));
  ipcMain.handle(InvokeChannel.OpenmaTasksRefresh, (_event, value: unknown) => tasks.refresh(scope(value)));
  ipcMain.handle(InvokeChannel.OpenmaTaskUpdate, (_event, id: unknown, patch: unknown) => tasks.update(text(id), patch as OpenmaTaskUpdate));
  ipcMain.handle(InvokeChannel.OpenmaTasksSearch, (_event, query: unknown, limit?: number) => tasks.search(text(query), limit));
  ipcMain.handle(InvokeChannel.OpenmaTaskFiles, (_event, id: unknown) => tasks.files(text(id)));
  ipcMain.handle(InvokeChannel.OpenmaTaskFilePreview, (_event, id: unknown, fileId: unknown) => tasks.previewFile(text(id), text(fileId)));
  ipcMain.handle(InvokeChannel.OpenmaTaskFileDownload, async (_event, id: unknown, fileId: unknown) => {
    const taskId = text(id); const selected = text(fileId);
    const file = (await tasks.files(taskId)).find((file) => file.id === selected);
    if (!file) throw new Error("File is no longer available");
    const result = await dialog.showSaveDialog({ defaultPath: file.name.replace(/[\\/]/g, "_"), title: "Save OpenMA file" });
    if (result.canceled || !result.filePath) return;
    const { bytes } = await tasks.readFile(taskId, selected);
    await writeFile(result.filePath, bytes, { mode: 0o600 });
  });
  ipcMain.handle(InvokeChannel.OpenmaTaskCreate, (_event, value: unknown, title: unknown) => {
    const target = value as Partial<OpenmaExecutionTarget> | null;
    if (!target || !["cloud", "runner"].includes(target.kind ?? "") || ![target.baseUrl, target.userId, target.workspaceId, target.agentId, target.environmentId].every((s) => typeof s === "string" && !!s) || !(target.runtimeId === null || typeof target.runtimeId === "string")) throw new Error("Choose an execution location");
    return tasks.create(target as OpenmaExecutionTarget, text(title).slice(0, 200));
  });
  ipcMain.handle(InvokeChannel.OpenmaTaskOpen, (event, id: unknown, subscriptionId: unknown) => {
    const owner = ownerKey(event.sender, subscriptionId);
    const snapshot = tasks.open(text(id), owner);
    own(event.sender, owner);
    return snapshot;
  });
  ipcMain.handle(InvokeChannel.OpenmaTaskDetach, (event, id: unknown, subscriptionId: unknown) => {
    const owner = ownerKey(event.sender, subscriptionId);
    tasks.detach(text(id), owner);
    clients.get(event.sender.id)?.delete(owner);
  });
  ipcMain.handle(InvokeChannel.OpenmaTaskSend, (_event, id: unknown, operation: unknown, input: unknown) => tasks.send(text(id), text(operation), text(input)));
  ipcMain.handle(InvokeChannel.OpenmaTaskInterrupt, (_event, id: unknown) => tasks.interrupt(text(id)));
  ipcMain.handle(InvokeChannel.OpenmaTaskRespond, (_event, id: unknown, requestId: unknown, value: unknown) => {
    const response = value as Partial<OpenmaTaskResponse> | null;
    if (!response || !(response.type === "confirmation" && (response.result === "allow" || response.result === "deny") || response.type === "custom_result" && typeof response.text === "string" && response.text.length <= 1_000_000 && (response.isError === undefined || typeof response.isError === "boolean"))) throw new Error("Invalid OpenMA response");
    return tasks.respond(text(id), text(requestId), response as OpenmaTaskResponse);
  });
}

export async function registerOpenmaIpc(directory: string): Promise<OpenmaAccount> {
  const account = new OpenmaAccount({
    directory,
    openExternal: (url) => shell.openExternal(url),
    onChange: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(PushChannel.OpenmaAccount, state);
      }
    },
  });
  await account.restore();
  ipcMain.handle(InvokeChannel.OpenmaAccountState, () => account.state());
  ipcMain.handle(InvokeChannel.OpenmaRemoveDirect, (_event, id: unknown) => { if (typeof id !== "string") throw new Error("Choose a connection"); return account.removeDirect(id); });
  ipcMain.handle(InvokeChannel.OpenmaConnectDirect, (_event, input: import("../shared/openma.js").DirectAgentConnectionInput) => account.connectDirect(input));
  ipcMain.handle(InvokeChannel.OpenmaLogin, async (_event, url: unknown) => {
    if (typeof url !== "string") throw new Error("OpenMA server address is required");
    await account.login(url);
    const window = BrowserWindow.getAllWindows()[0];
    if (window && process.env.BACKCHAT_TEST_HOOKS !== "1") { window.show(); window.focus(); }
  });
  ipcMain.handle(InvokeChannel.OpenmaCancelLogin, () => account.cancelLogin());
  ipcMain.handle(InvokeChannel.OpenmaLogout, () => account.logout());
  ipcMain.handle(InvokeChannel.OpenmaSelectWorkspace, (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("Choose a workspace");
    return account.selectWorkspace(id);
  });
  return account;
}

export function registerOpenmaRunnerIpc(account: OpenmaAccount, runner: OpenmaRunner): () => void {
  ipcMain.handle(InvokeChannel.OpenmaRunnerState, () => runner.state());
  ipcMain.handle(InvokeChannel.OpenmaRunnerEnable, () => runner.enable());
  ipcMain.handle(InvokeChannel.OpenmaRunnerDisable, () => runner.disable());
  let owner = `${account.state().baseUrl}/${account.state().user?.id ?? ""}`;
  return account.subscribe((state) => {
    const nextOwner = `${state.baseUrl}/${state.user?.id ?? ""}`;
    if (state.provider || state.status === "signed_out" || state.status === "expired" || owner !== nextOwner) runner.stop();
    owner = nextOwner;
  });
}

export function registerOpenmaProjectIpc(account: OpenmaAccount, service: OpenmaProjectService): void {
  const binding = (value: unknown): OpenmaProjectBinding => {
    const p = value as Partial<OpenmaProjectBinding> | null;
    if (!p || typeof p.projectId !== "string" || typeof p.environmentId !== "string" || !(p.runtimeId === null || typeof p.runtimeId === "string")) throw new Error("Choose a project and environment");
    return { projectId: p.projectId, environmentId: p.environmentId, runtimeId: p.runtimeId };
  };
  ipcMain.handle(InvokeChannel.OpenmaCatalog, (_event, value: unknown) => service.catalog(scope(value)));
  ipcMain.handle(InvokeChannel.OpenmaProjectBindings, () => service.list());
  ipcMain.handle(InvokeChannel.OpenmaLinkProject, (_event, value: unknown) => service.link(binding(value)));
  ipcMain.handle(InvokeChannel.OpenmaUnlinkProject, (_event, value: unknown) => service.unlink(binding(value)));
  ipcMain.handle(InvokeChannel.OpenmaOpenManagement, () => shell.openExternal(account.connection().baseUrl));
}
