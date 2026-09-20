import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenmaProjectEnvironments } from "./openma-project-environments.js";
import type { ProjectInfo } from "../shared/projects.js";

const root = mkdtempSync(join(tmpdir(), "backchat-project-environments-"));
let store: OpenmaProjectEnvironments | undefined;
afterEach(() => { store?.close(); store = undefined; rmSync(root, { recursive: true, force: true }); });
const scope = { baseUrl: "https://app.openma.ai", userId: "user", workspaceId: "team" };
const project: ProjectInfo = { id: "p", name: "App", source_folders: ["/work/app", "/work/shared"], primary_folder: "/work/app", created_at: 1, updated_at: 1 };
const project2: ProjectInfo = { ...project, id: "p2", name: "Docs", source_folders: ["/work/docs"], primary_folder: "/work/docs" };

describe("project-scoped runner environments", () => {
  it("persists scoped runner associations without confusing local or observer task IDs", () => {
    const path = join(root, "bindings.db");
    store = new OpenmaProjectEnvironments(path, () => project);
    const scopes = [scope, { ...scope, workspaceId: "other" }, { ...scope, userId: "other" }, { ...scope, baseUrl: "https://self.example" }];
    const associations = scopes.map((s) => {
      store!.link(s, { projectId: "p", environmentId: "env", runtimeId: "runner" });
      return store!.resolveRunnerSession(s, "runner", "env", "same", "codex-acp");
    });
    expect(new Set(associations.map((a) => a.localSessionId)).size).toBe(4);
    for (const a of associations) {
      expect(a.localSessionId).not.toBe("same");
      expect(a.localSessionId).not.toBe(a.taskId);
    }
    store.close(); store = new OpenmaProjectEnvironments(path, () => project2);
    expect(store.runnerSession("same")).toBeNull();
    for (const a of associations) {
      expect(store.runnerSession(a.localSessionId)).toEqual(a);
      expect(store.runnerSession(a.taskId)).toBeNull();
    }
    expect(store.resolveRunnerSession(scope, "runner", "env", "same", "codex-acp")).toEqual(associations[0]);
    expect(() => store!.resolveRunnerSession(scope, "runner", "env", "same", "claude-acp")).toThrow(/agent.*change/i);
    expect(() => store!.resolveRunnerSession(scope, "other", "env", "same", "codex-acp")).toThrow(/environment.*change/i);
  });

  it("keeps an existing task in its original project directory across relinking and restart", () => {
    let current = project;
    const path = join(root, "bindings.db");
    store = new OpenmaProjectEnvironments(path, () => current);
    store.link(scope, { projectId: "p", environmentId: "env", runtimeId: "runner" });
    expect(store.resolveSession(scope, "runner", "env", "task").cwd).toBe("/work/app");
    store.close(); current = { ...project, primary_folder: "/new/app", source_folders: ["/new/app"] };
    store = new OpenmaProjectEnvironments(path, () => current);
    expect(store.resolveSession(scope, "runner", "env", "task").cwd).toBe("/work/app");
    expect(store.resolveSession(scope, "runner", "env", "new-task").cwd).toBe("/new/app");
    expect(() => store!.resolveSession(scope, "runner", "different-env", "task")).toThrow(/environment.*change/i);
  });

  it("allows multiple project environments on one machine and never defaults to the computer root", () => {
    store = new OpenmaProjectEnvironments(join(root, "bindings.db"), (id) => id === "p" ? project : id === "p2" ? project2 : null);
    expect(() => store!.resolve(scope, "runner", "unknown-env")).toThrow(/linked project/i);
    store.link(scope, { projectId: "p", environmentId: "app-env", runtimeId: "runner" });
    store.link(scope, { projectId: "p2", environmentId: "docs-env", runtimeId: "runner" });
    expect(store.resolve(scope, "runner", "app-env")).toEqual({ projectId: "p", cwd: "/work/app", additionalDirectories: ["/work/shared"] });
    expect(store.resolve(scope, "runner", "docs-env")).toEqual({ projectId: "p2", cwd: "/work/docs", additionalDirectories: [] });
    expect(() => store!.resolve(scope, "other-runner", "app-env")).toThrow(/linked project/i);
    expect(() => store!.resolve({ ...scope, workspaceId: "other-team" }, "runner", "app-env")).toThrow(/linked project/i);
  });

  it("restores bindings, reads current project roots, and rejects deleted projects", () => {
    let current: ProjectInfo | null = project;
    store = new OpenmaProjectEnvironments(join(root, "bindings.db"), () => current);
    store.link(scope, { projectId: "p", environmentId: "env", runtimeId: "runner" });
    store.close();
    current = { ...project, primary_folder: "/new/app", source_folders: ["/new/app"] };
    store = new OpenmaProjectEnvironments(join(root, "bindings.db"), () => current);
    expect(store.resolve(scope, "runner", "env").cwd).toBe("/new/app");
    current = null;
    expect(() => store!.resolve(scope, "runner", "env")).toThrow(/project.*available/i);
  });

  it("keeps a cloud binding separate from local runner directory resolution", () => {
    store = new OpenmaProjectEnvironments(join(root, "bindings.db"), () => project);
    store.link(scope, { projectId: "p", environmentId: "cloud-env", runtimeId: null });
    expect(store.list(scope, "p")).toEqual([{ projectId: "p", environmentId: "cloud-env", runtimeId: null }]);
    expect(() => store!.resolve(scope, "runner", "cloud-env")).toThrow(/linked project/i);
    store.unlink(scope, "cloud-env", null);
    expect(store.list(scope, "p")).toEqual([]);
  });
});
