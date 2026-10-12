/**
 * @vitest-environment happy-dom
 */
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@shared/projects";

const harness = vi.hoisted(() => ({
  projects: [] as ProjectInfo[],
  recents: [] as Array<{ cwd?: string | null }>,
  owners: {} as Record<string, string>,
  invalidateQueries: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: harness.invalidateQueries }),
  useQueries: () => [{ data: null }],
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "sessions-for-recent-cwds" ? harness.recents
      : queryKey[1] === "folder-owners" ? harness.owners
      : queryKey[0] === "projects" ? harness.projects : null,
    isSuccess: true,
  }),
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => {
    useEffect(() => onOpenChange?.(true), []);
    return <div>{children}</div>;
  },
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./RuntimeLocationControl", () => ({ RuntimeLocationControl: () => null }));

import { rememberRemovedProject } from "@/lib/removed-projects";
import { ProjectChipRow } from "./ComposerProjectControls";

const project = (id: string, name: string, folder: string): ProjectInfo => ({
  id, name, source_folders: [folder], primary_folder: folder, created_at: 0, updated_at: 0,
});

describe("ProjectChipRow picker identity", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    // The registry (main) already collapsed the second hilo-coord-test record.
    harness.projects = [
      project("proj-mmdesign", "mmdesign", "/work/mmdesign"),
      project("proj-hilo-a", "hilo-coord-test", "/work/hilo-coord-test"),
    ];
    harness.recents = [
      { cwd: "/work/hilo-coord-test/" }, { cwd: "/link/hilo" }, { cwd: "/work/scratch" }, { cwd: "/work/scratch/" },
    ];
    harness.owners = { "/link/hilo": "proj-hilo-a", "~/work/mmdesign": "proj-mmdesign" };
    harness.invalidateQueries.mockClear();
    Object.assign(window, { backchat: { onProjectsChanged: () => () => undefined } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (
    activeCwd: string,
    projectId?: string,
    handlers: { onPickCwd?: () => Promise<string | null>; onSetCwd?: (path: string) => void } = {},
  ) => act(() => root.render(
    <ProjectChipRow
      key={activeCwd}
      isDraft
      activeCwd={activeCwd}
      projectId={projectId}
      onPickCwd={handlers.onPickCwd ?? (async () => null)}
      onSetCwd={handlers.onSetCwd ?? (() => undefined)}
      onClearCwd={() => undefined}
    />,
  ));
  const items = () => [...container.querySelectorAll<HTMLElement>("[cmdk-item]")];
  const rowNamed = (name: string) => items().filter((item) => item.textContent?.includes(name));
  const selected = () => container.querySelectorAll('[data-selected="true"]');
  const checked = () => container.querySelectorAll<HTMLElement>('[data-checked="true"]');

  it("keys rows by project id and canonical path so only the checked row highlights", () => {
    render("/work/hilo-coord-test", "proj-hilo-a");

    const values = items().map((item) => item.getAttribute("data-value"));
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual(expect.arrayContaining(["proj-mmdesign", "proj-hilo-a", "/work/scratch"]));
    expect(values.filter((value) => value?.startsWith("/work/scratch"))).toEqual(["/work/scratch"]);
    expect(rowNamed("hilo-coord-test")).toHaveLength(1);
    expect(selected()).toHaveLength(1);
    const [highlighted] = selected();
    expect(highlighted!.getAttribute("data-value")).toBe("proj-hilo-a");
    expect([...checked()]).toEqual([highlighted]);
    expect(highlighted!.querySelector(".app-select-selected")).not.toBeNull();

    const [other] = rowNamed("mmdesign");
    act(() => {
      other!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });
    expect(selected()).toHaveLength(1);
    expect(other!.getAttribute("data-selected")).toBe("true");
  });

  it("selects the registry's project when Browse picks an already-registered folder", async () => {
    const projectSave = vi.fn(async () => harness.projects[1]!);
    Object.assign(window, { backchat: { onProjectsChanged: () => () => undefined, projectSave } });
    const onSetCwd = vi.fn();
    render("", undefined, { onPickCwd: async () => "/link/hilo", onSetCwd });

    const [browse] = items().filter((item) => item.getAttribute("data-value")?.endsWith("browse"));
    await act(async () => browse!.click());
    await vi.waitFor(() => expect(onSetCwd).toHaveBeenCalledWith("/work/hilo-coord-test"));
    expect(projectSave).toHaveBeenCalledWith(expect.objectContaining({ source_folders: ["/link/hilo"] }));
    expect(harness.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["projects"] });
  });

  it("matches symlink, ~ and trailing-slash variants to their project like the registry", () => {
    render("~/work/mmdesign");
    expect(checked()).toHaveLength(1);
    expect(checked()[0]!.textContent).toContain("mmdesign");
    expect(selected()).toHaveLength(1);
    expect(selected()[0]).toBe(checked()[0]);

    const recentValues = items().map((item) => item.getAttribute("data-value"));
    expect(recentValues).not.toContain("/link/hilo");
    expect(recentValues).not.toContain("/work/hilo-coord-test/");
    expect(recentValues).toContain("/work/scratch");
  });

  it("hides removed recents unless a project owns them and highlights No project without a cwd", () => {
    harness.recents = [{ cwd: null }, { cwd: "/link/hilo" }, { cwd: "/work/gone" }, { cwd: "/work/scratch" }];
    rememberRemovedProject(["/link/hilo", "/work/gone"]);
    render("");

    const values = items().map((item) => item.getAttribute("data-value"));
    expect(values).not.toContain("/work/gone");
    expect(values).not.toContain("/link/hilo");
    expect(values).toContain("/work/scratch");
    expect(checked()).toHaveLength(1);
    expect(selected()).toHaveLength(1);
    expect(selected()[0]).toBe(checked()[0]);
    expect(selected()[0]!.textContent).toContain("chat.noProject");
  });

  it("checks the recent directory when no project owns the cwd", () => {
    render("/work/scratch");
    expect(selected()[0]!.getAttribute("data-value")).toBe("/work/scratch");
    expect(checked()).toHaveLength(1);
  });
});
