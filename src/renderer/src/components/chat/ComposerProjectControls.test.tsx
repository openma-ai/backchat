import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: () => undefined }),
  useQueries: () => [{ data: null }],
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === "workspaces"
        ? [
            {
              id: "live-workspace",
              kind: "live",
              worktrees: [
                {
                  repoRoot: "/Users/mini/work/alpha",
                  path: "/Users/mini/work/alpha",
                  branch: "main",
                },
              ],
            },
          ]
        : queryKey[0] === "sessions-for-recent-cwds"
        ? [
            { cwd: "/Users/mini/work/alpha" },
            { cwd: "/Users/mini/work/beta" },
          ]
        : queryKey[0] === "projects" ? [{ id: "alpha-project", name: "Alpha display name", primary_folder: "/Users/mini/work/alpha", source_folders: ["/Users/mini/work/alpha"], created_at: 0, updated_at: 0 }] : null,
  }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "chat.chooseProject": "Choose project",
        "chat.chooseProjectFolder": "Choose a project folder",
        "chat.whereRuns": "Where this runs",
        "chat.local": "Local",
        "chat.cloud": "Cloud",
        "chat.comingSoon": "Coming soon",
        "chat.noProject": "No project",
        "common.browse": "Browse…",
      })[key] ?? key,
  }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-slot="dropdown-menu">{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({
    children,
    sideOffset,
  }: {
    children: React.ReactNode;
    sideOffset?: number;
  }) => <div data-side-offset={sideOffset}>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ProjectChipRow } from "./ComposerProjectControls";

describe("ProjectChipRow", () => {
  it("uses cmdk for the growing project list while runtime stays a fixed dropdown", () => {
    const html = renderToStaticMarkup(
      <ProjectChipRow
        isDraft
        activeCwd="/Users/mini/work/alpha"
        onPickCwd={async () => null}
        onSetCwd={() => undefined}
        onClearCwd={() => undefined}
      />,
    );

    expect(html).toContain("cmdk-root");
    expect(html).toContain("cmdk-input");
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("Alpha display name");
    expect(html).toContain('data-project-glyph=');
    expect(html.match(/title="\/Users\/mini\/work\/alpha"/g)).toHaveLength(2);
    expect(html).toContain("chat.recentDirectories");
    expect(html).toContain("Browse…");
    expect(html).toContain("No project");
    expect(html).toContain('data-side-offset="0"');
    expect(html.match(/data-slot="dropdown-menu"/g)).toHaveLength(1);
    expect(html.indexOf('data-composer-footer-control="runtime"')).toBeLessThan(
      html.indexOf('data-composer-footer-control="project"'),
    );
  });

  it("uses the shared composer footer trigger", () => {
    const html = renderToStaticMarkup(
      <ProjectChipRow
        isDraft
        activeCwd=""
        onPickCwd={async () => null}
        onSetCwd={() => undefined}
        onClearCwd={() => undefined}
      />,
    );

    const trigger = html.match(
      /<button[^>]*data-composer-footer-control="project"[^>]*>/,
    )?.[0];
    expect(trigger).toContain("composer-footer-trigger");
  });

  it("anchors the workspace picker to its composer chip", () => {
    const html = renderToStaticMarkup(
      <ProjectChipRow
        isDraft
        projectId="alpha-project"
        activeCwd="/Users/mini/work/alpha"
        onPickCwd={async () => null}
        onSetCwd={() => undefined}
        onClearCwd={() => undefined}
        onSetWorkspace={() => undefined}
      />,
    );

    expect(html).toContain('data-composer-footer-control="workspace"');
    expect(html).toContain('data-testid="composer-workspace-picker-panel"');
    expect(html.match(/data-side-offset="0"/g)).toHaveLength(2);
  });
});
