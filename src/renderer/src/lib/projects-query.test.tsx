/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@shared/projects";
import { useFolderProjectOwners, useProjects } from "./projects-query";

const project = (id: string, folder: string, created_at: number): ProjectInfo => ({
  id, name: "hilo-coord-test", source_folders: [folder], primary_folder: folder, created_at, updated_at: 0,
});

describe("projects query", () => {
  let root: Root;
  let container: HTMLDivElement;
  let changed: () => void;
  const seen: { projects?: ProjectInfo[]; owners?: Record<string, string> } = {};
  const api = {
    projectsList: vi.fn(async () => [project("proj-b", "/work/hilo", 2), project("proj-a", "/work/hilo", 1)]),
    projectFolderOwners: vi.fn(async ({ paths }: { paths: string[] }) =>
      Object.fromEntries(paths.map((path) => [path, "proj-a"]))),
    onProjectsChanged: (handler: () => void) => {
      changed = handler;
      return () => undefined;
    },
  };

  function Probe({ paths }: { paths: string[] }) {
    seen.projects = useProjects().data;
    seen.owners = useFolderProjectOwners(paths);
    return null;
  }

  beforeEach(() => {
    Object.assign(window, { backchat: api });
    api.projectsList.mockClear();
    api.projectFolderOwners.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => act(() => root.unmount()));

  const render = (paths: string[]) => act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe paths={paths} />
      </QueryClientProvider>,
    );
  });

  it("uses the registry list as-is and resolves folder owners through main", async () => {
    await render(["~/work/hilo", "", "/link/hilo", "~/work/hilo"]);
    await vi.waitFor(() => expect(seen.owners).toEqual({ "/link/hilo": "proj-a", "~/work/hilo": "proj-a" }));
    expect(seen.projects?.map((saved) => saved.id)).toEqual(["proj-b", "proj-a"]);
    expect(api.projectFolderOwners).toHaveBeenCalledWith({ paths: ["/link/hilo", "~/work/hilo"] });

    await act(async () => changed());
    await vi.waitFor(() => expect(api.projectFolderOwners).toHaveBeenCalledTimes(2));
    expect(api.projectsList).toHaveBeenCalledTimes(2);
  });

  it("asks for no owners when there are no paths", async () => {
    await render([""]);
    expect(seen.owners).toEqual({});
    expect(api.projectFolderOwners).not.toHaveBeenCalled();
  });
});
