import type { DatabaseSync } from "node:sqlite";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, sep } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { ProjectWorkspaceRegistry } from "@openmatter/project-host";
import type { JsonValue } from "@openmatter/core";
import { ManagedWorktreeStore, repoRootOf } from "./worktree-manager.js";
import type { ProjectInfo } from "../shared/projects.js";
const execFile = promisify(execFileCallback);
interface Spec {
  kind: "local";
  sources: string[];
  gitSources: string[];
  plainSources: string[];
  baseRefs: Record<string, string>;
}
export interface ProjectLocalWorkspace {
  id: string;
  cwd: string;
  additionalDirectories: string[];
  memoryDirectory?: string;
  branch: string | null;
  worktrees: {
    repoRoot: string;
    path: string;
    head: string;
    branch: string | null;
  }[];
}
/** Existing Git worktree storage, with lifetime and identity owned by WorkThread. */
export class ProjectWorkspaceManager {
  readonly registry: ProjectWorkspaceRegistry;
  readonly store: ManagedWorktreeStore;
  readonly #pending = new Map<string, Promise<ProjectLocalWorkspace>>();
  constructor(
    db: DatabaseSync,
    readonly root: string,
  ) {
    this.registry = new ProjectWorkspaceRegistry(db);
    this.store = new ManagedWorktreeStore(root);
  }
  prepare(
    project: ProjectInfo,
    thread: string,
    role: "coordinator" | "worker",
    baseRef = "HEAD",
  ): Promise<ProjectLocalWorkspace> {
    const key = JSON.stringify([project.id, thread]);
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const result = this.#prepare(project, thread, role, baseRef)
      .then(async (workspace) => {
        // Memory belongs to the WorkThread, not its replaceable agent Session
        // or Git checkout. Keep it outside source roots and never reset notes.
        const memoryDirectory = join(this.root, `${workspace.id}-memory`);
        await mkdir(memoryDirectory, { recursive: true, mode: 0o700 });
        return {
          ...workspace,
          memoryDirectory,
          additionalDirectories: [
            ...new Set([...workspace.additionalDirectories, memoryDirectory]),
          ],
        };
      })
      .finally(() => this.#pending.delete(key));
    this.#pending.set(key, result);
    return result;
  }
  async #prepare(
    project: ProjectInfo,
    thread: string,
    role: "coordinator" | "worker",
    baseRef: string,
  ): Promise<ProjectLocalWorkspace> {
    await mkdir(this.root, { recursive: true });
    const storageRoot = await realpath(this.root);
    let binding = this.registry
      .list(project.id)
      .find((w) => w.workThreadId === thread);
    if (!binding) {
      const requested =
        role === "coordinator"
          ? []
          : [
              ...new Set(
                [project.primary_folder, ...project.source_folders].filter(
                  Boolean,
                ),
              ),
            ];
      const sources = await Promise.all(requested.map((p) => realpath(p)));
      const spec: Spec = {
        kind: "local",
        sources,
        gitSources: [],
        plainSources: [],
        baseRefs: {},
      };
      for (const source of sources) {
        const repo = await repoRootOf(source);
        if (repo) {
          spec.gitSources.push(source);
          if (!spec.baseRefs[repo])
            spec.baseRefs[repo] = (
              await execFile("git", [
                "-C",
                repo,
                "rev-parse",
                "--verify",
                "--end-of-options",
                `${baseRef || "HEAD"}^{commit}`,
              ])
            ).stdout.trim();
        } else {
          if (storageRoot === source || storageRoot.startsWith(source + sep))
            throw new Error(
              "Project source contains managed workspace storage; choose a narrower directory",
            );
          spec.plainSources.push(source);
        }
      }
      binding = this.registry.reserve(
        project.id,
        thread,
        spec as unknown as JsonValue,
      );
    }
    const spec = binding.spec as unknown as Spec;
    if (spec.kind !== "local")
      throw new Error("WorkThread belongs to another workspace provider");
    if (binding.location) {
      const existing = binding.location as unknown as ProjectLocalWorkspace;
      for (const path of [existing.cwd, ...existing.additionalDirectories])
        await access(path).catch(() => {
          throw new Error(
            `Thread workspace is missing: ${path}. Restore it before resuming; a fresh checkout was not created.`,
          );
        });
      if (spec.gitSources.length)
        await this.store.prepare({
          workspaceId: binding.id,
          sourceDirectories: spec.gitSources,
          branch: binding.branch,
          baseRefs: spec.baseRefs,
        });
      for (const tree of existing.worktrees) {
        const actual = (
          await execFile("git", ["-C", tree.path, "branch", "--show-current"])
        ).stdout.trim();
        if (actual !== tree.branch)
          throw new Error(
            `Thread workspace branch changed: ${tree.path}. Restore ${tree.branch} before resuming.`,
          );
      }
      return existing;
    }
    const git = spec.gitSources.length
      ? await this.store.prepare({
          workspaceId: binding.id,
          sourceDirectories: spec.gitSources,
          branch: binding.branch,
          baseRefs: spec.baseRefs,
        })
      : null;
    const plainRoot = join(this.root, `${binding.id}-files`);
    let ordinary: string[] = [];
    if (spec.plainSources.length || !spec.sources.length) {
      const manifest = join(plainRoot, "workspace.json");
      try {
        const saved = JSON.parse(await readFile(manifest, "utf8"));
        if (saved.id !== binding.id)
          throw new Error("Invalid ordinary workspace owner");
        ordinary = saved.paths;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const staging = plainRoot + ".preparing";
        await mkdir(this.root, { recursive: true });
        await rm(staging, { recursive: true, force: true });
        await mkdir(staging);
        try {
          for (let i = 0; i < spec.plainSources.length; i++) {
            const name = `source-${i + 1}`;
            await cp(spec.plainSources[i]!, join(staging, name), {
              recursive: true,
              filter: async (path) => {
                if ((await lstat(path)).isSymbolicLink())
                  throw new Error(
                    "Non-Git project sources must not contain symlinks; attach their contents as resources instead",
                  );
                return true;
              },
            });
            ordinary.push(join(plainRoot, name));
          }
          if (!ordinary.length) {
            await mkdir(join(staging, "work"));
            ordinary.push(join(plainRoot, "work"));
          }
          await writeFile(
            join(staging, "workspace.json"),
            JSON.stringify({ id: binding.id, paths: ordinary }),
          );
          await rename(staging, plainRoot);
        } catch (error) {
          await rm(staging, { recursive: true, force: true });
          throw error;
        }
      }
    }
    const mapped = spec.sources.map(
      (source) =>
        git?.roots.find((r) => r.sourcePath === source)?.effectivePath ??
        ordinary[spec.plainSources.indexOf(source)]!,
    );
    const paths = mapped.length ? mapped : ordinary;
    const location: ProjectLocalWorkspace = {
      id: binding.id,
      cwd: paths[0]!,
      additionalDirectories: paths.slice(1),
      branch: git?.branch ?? null,
      worktrees: git?.worktrees ?? [],
    };
    this.registry.complete(binding.id, location as unknown as JsonValue);
    return location;
  }
}
