import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "project.create": "Create project",
      "project.name": "Project name",
      "project.sourceFolders": "Source folders",
      "project.addFolders": "Add folders OpenMA can read and edit",
      "project.primary": "Primary",
      "project.makePrimary": "Make primary",
      "project.removeFolder": "Remove folder",
      "common.cancel": "Cancel",
    })[key] ?? key,
  }),
}));

import {
  CreateProjectDialog,
  ProjectFolderList,
} from "./CreateProjectDialog";

describe("CreateProjectDialog", () => {
  it("keeps source folders in one project form and disables creation without a name", () => {
    const html = renderToStaticMarkup(
      <CreateProjectDialog
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    expect(html).toContain("Create project");
    expect(html).toContain("Project name");
    expect(html).toContain("Source folders");
    expect(html).toContain("Add folders OpenMA can read and edit");
    expect(html).toContain('disabled=""');
  });

  it("distinguishes the primary cwd from secondary source folders", () => {
    const html = renderToStaticMarkup(
      <ProjectFolderList
        folders={["/work/app", "/work/docs"]}
        onAdd={vi.fn()}
        onMakePrimary={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain("app");
    expect(html).toContain("docs");
    expect(html).toContain("Primary");
    expect(html).toContain("Make primary");
    expect(html).toContain("Remove folder");
  });
});
