import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  userInfo: () => ({ homedir: env.home }),
}));

import { saveProjectCommand } from "./project-commands";
import { expandHomeFolder, findProjectByFolders, folderIdentity, folderProjectOwners } from "./project-identity";
import { getProject, listProjects, openSessionDb, saveProject } from "./sql-store";

describe("project registry dedup", () => {
  let root = "";
  let repo = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "openma-project-identity-"));
    env.home = join(root, "home");
    repo = join(env.home, "hilo-coord-test");
    await mkdir(repo, { recursive: true });
    await mkdir(join(env.home, "other"), { recursive: true });
    await symlink(repo, join(root, "hilo-link"));
    openSessionDb(join(root, "sessions.db"));
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("resolves ~, trailing slashes and symlinks to one folder identity", () => {
    expect(expandHomeFolder("~")).toBe(env.home);
    expect(expandHomeFolder("~/hilo-coord-test")).toBe(repo);
    expect(expandHomeFolder(" /abs ")).toBe("/abs");
    expect(expandHomeFolder("~other/x")).toBe("~other/x");
    const real = folderIdentity(repo);
    expect(folderIdentity(`${repo}/`)).toBe(real);
    expect(folderIdentity("~/hilo-coord-test")).toBe(real);
    expect(folderIdentity(join(root, "hilo-link"))).toBe(real);
    expect(folderIdentity("/missing/folder/")).toBe("/missing/folder");
  });

  it("saves the same folder once across fresh ids and path variants", () => {
    const variants = [repo, `${repo}/`, "~/hilo-coord-test", join(root, "hilo-link")];
    const saved = variants.map((folder, index) => saveProjectCommand({
      project_id: `proj-ui-${index}`,
      name: index ? `hilo copy ${index}` : "hilo-coord-test",
      source_folders: [folder],
      primary_folder: folder,
      requireId: true,
    }));

    expect(saved.map((project) => project.id)).toEqual(Array(4).fill("proj-ui-0"));
    expect(saved.map((project) => project.created)).toEqual([true, false, false, false]);
    expect(listProjects().map((project) => project.id)).toEqual(["proj-ui-0"]);
    expect(saveProjectCommand({ name: "cli", source_folders: [`${repo}/`] }))
      .toMatchObject({ id: "proj-ui-0", created: false });
  });

  it("stores ~ folders as absolute paths and still edits a project in place", () => {
    const other = saveProjectCommand({
      project_id: "proj-other",
      name: "other",
      source_folders: ["~/other"],
      primary_folder: "~/other",
      requireId: true,
    });
    expect(other).toMatchObject({ primary_folder: join(env.home, "other"), created: true });

    expect(saveProjectCommand({
      project_id: "proj-other",
      name: "renamed",
      source_folders: ["~/other/"],
      requireId: true,
    })).toMatchObject({ id: "proj-other", name: "renamed", created: true });
    expect(() => saveProjectCommand({
      project_id: "proj-other",
      name: "renamed",
      source_folders: [repo],
      requireId: true,
    })).toThrow("These folders already belong to project hilo-coord-test");
  });

  it("saves an id-addressed project without folders", () => {
    expect(saveProjectCommand({ project_id: "proj-bare", name: "bare", requireId: true }))
      .toMatchObject({ id: "proj-bare", source_folders: [] });
  });

  it("collapses duplicates that were registered before dedup", () => {
    saveProject({ id: "proj-legacy-dup", name: "hilo-coord-test", source_folders: [`${repo}/`] });

    expect(getProject("proj-legacy-dup")).not.toBeNull();
    expect(listProjects().filter((project) => project.name === "hilo-coord-test").map((project) => project.id))
      .toEqual(["proj-ui-0"]);
    expect(findProjectByFolders(listProjects(), [join(root, "hilo-link")])?.id).toBe("proj-ui-0");
    expect(findProjectByFolders(listProjects(), [])).toBeUndefined();
  });
  it("maps recent paths to the project that owns them by folder identity", () => {
    const owner = saveProject({ id: "proj-owner", name: "owner", source_folders: [repo, join(env.home, "other")] });
    const later = { ...owner, id: "proj-later", source_folders: [`${repo}/`] };
    expect(folderProjectOwners([owner, later], [
      "~/hilo-coord-test",
      join(root, "hilo-link"),
      `${repo}/`,
      "~/other",
      "/work/scratch",
      "",
    ])).toEqual({
      "~/hilo-coord-test": "proj-owner",
      [join(root, "hilo-link")]: "proj-owner",
      [`${repo}/`]: "proj-owner",
      "~/other": "proj-owner",
    });
  });
});
