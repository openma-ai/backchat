import { describe, expect, it } from "vitest";
import {
  canonicalProjectFolder,
  dedupeProjects,
  normalizeProjectFolders,
  projectFolderSetKey,
  type ProjectInfo,
} from "./projects";

const project = (id: string, folders: string[], created_at = 0): ProjectInfo => ({
  id,
  name: id,
  source_folders: folders,
  primary_folder: folders[0] ?? "",
  created_at,
  updated_at: created_at,
});

const byFolders = (project: ProjectInfo) => projectFolderSetKey(project.source_folders);

describe("project folder identity", () => {
  it("drops surrounding whitespace and trailing separators but keeps the root", () => {
    expect(canonicalProjectFolder(" /work/app/ ")).toBe("/work/app");
    expect(canonicalProjectFolder("/work/app//")).toBe("/work/app");
    expect(canonicalProjectFolder("C:\\work\\app\\")).toBe("C:\\work\\app");
    expect(canonicalProjectFolder("/")).toBe("/");
    expect(canonicalProjectFolder("  ")).toBe("");
  });

  it("dedupes trailing-slash variants inside one project", () => {
    expect(normalizeProjectFolders({
      source_folders: ["/work/api/", "/work/web", "/work/api"],
      primary_folder: "/work/web/",
    })).toEqual({ primary_folder: "/work/web", source_folders: ["/work/web", "/work/api"] });
  });

  it("keys a folder set independently of order, duplicates and resolver", () => {
    expect(projectFolderSetKey(["/b/", "/a", "/b"])).toBe(projectFolderSetKey(["/a", "/b"]));
    expect(projectFolderSetKey([" ", ""])).toBe("");
    expect(projectFolderSetKey(["/link"], (folder) => folder.replace("/link", "/real")))
      .toBe(projectFolderSetKey(["/real"]));
  });

  it("collapses projects that share a folder set onto the earliest one", () => {
    const original = project("proj-original", ["/work/hilo"], 1);
    const duplicate = project("proj-duplicate", ["/work/hilo/"], 2);
    const tie = project("proj-a-tie", ["/work/hilo"], 1);
    const other = project("proj-other", ["/work/other"], 3);
    const folderless = [project("proj-empty-1", [], 4), project("proj-empty-2", [], 5)];

    expect(dedupeProjects([duplicate, original, other, ...folderless], byFolders).map((p) => p.id))
      .toEqual(["proj-original", "proj-other", "proj-empty-1", "proj-empty-2"]);
    expect(dedupeProjects([original, tie], byFolders).map((p) => p.id)).toEqual(["proj-a-tie"]);
  });
});
