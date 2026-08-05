import { describe, expect, it } from "vitest";

import { normalizeProjectFolders } from "./projects";

describe("normalizeProjectFolders", () => {
  it("keeps an explicit primary folder first while trimming and deduplicating roots", () => {
    expect(
      normalizeProjectFolders({
        source_folders: [
          " /work/frontend ",
          "/work/backend",
          "/work/frontend",
          "",
        ],
        primary_folder: " /work/backend ",
      }),
    ).toEqual({
      primary_folder: "/work/backend",
      source_folders: ["/work/backend", "/work/frontend"],
    });
  });

  it("uses the first source folder as primary and permits folderless projects", () => {
    expect(
      normalizeProjectFolders({
        source_folders: ["/work/app", "/work/docs"],
      }),
    ).toEqual({
      primary_folder: "/work/app",
      source_folders: ["/work/app", "/work/docs"],
    });
    expect(normalizeProjectFolders({ source_folders: [] })).toEqual({
      primary_folder: "",
      source_folders: [],
    });
  });
});
