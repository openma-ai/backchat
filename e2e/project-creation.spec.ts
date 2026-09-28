import { expect, test } from "./fixtures";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test.describe("project creation", () => {
  test("opening a legacy coordinator promotes one project without splitting its workspace chats", async ({
    page,
    bridge,
    home,
    capture,
  }) => {
    const name = "hilo-agent-opencode";
    const source = join(home, name);
    const checkoutRoot = join(home, "worktrees", "fix-abc");
    const roots = [
      {
        sourcePath: join(source, "api"),
        effectivePath: join(checkoutRoot, "01-api"),
        worktreeIndex: 0,
      },
      {
        sourcePath: join(source, "web"),
        effectivePath: join(checkoutRoot, "02-web"),
        worktreeIndex: 1,
      },
    ];
    for (const root of roots) {
      await mkdir(root.sourcePath, { recursive: true });
      await mkdir(root.effectivePath, { recursive: true });
    }
    const worktrees = roots.map((root) => ({
      repoRoot: root.sourcePath,
      path: root.effectivePath,
      head: "abc123",
      branch: "fix-abc",
    }));
    await bridge.persistSessionFixture({
      sessionId: "legacy-source-chat",
      title: "Existing source conversation",
      cwd: source,
      acpSessionId: "",
      events: [
        { type: "user_prompt", data: { text: "Keep the source history" } },
      ],
    });
    await bridge.persistSessionFixture({
      sessionId: "legacy-workspace-chat",
      title: "Existing workspace conversation",
      cwd: roots[0].effectivePath,
      acpSessionId: "",
      events: [
        { type: "user_prompt", data: { text: "Keep the workspace history" } },
      ],
    });
    // Reproduce the old persisted shape, which predates saved project IDs.
    // The fixture's isolated BACKCHAT_HOME is the only database touched.
    const db = new DatabaseSync(join(home, "sessions.db"));
    try {
      db.prepare(
        `INSERT INTO workspaces (
        id, project_id, name, kind, branch, root_dir,
        source_directories_json, roots_json, worktrees_json,
        created_by_session_id, created_at, updated_at
      ) VALUES (?, NULL, ?, 'managed', ?, ?, ?, ?, ?, NULL, 1, 1)`,
      ).run(
        "legacy-fix-workspace",
        "fix-abc",
        "fix-abc",
        checkoutRoot,
        JSON.stringify(roots.map((root) => root.sourcePath)),
        JSON.stringify(roots),
        JSON.stringify(worktrees),
      );
      db.prepare("UPDATE sessions SET workspace_id = ? WHERE id = ?").run(
        "legacy-fix-workspace",
        "legacy-workspace-chat",
      );
    } finally {
      db.close();
    }

    await page.reload();
    const sidebar = page.getByRole("complementary").first();
    const legacyCoordinator = sidebar.getByRole("button", {
      name: `Set up project coordinator: ${name}`,
      exact: true,
    });
    const expandProject = sidebar.getByRole("button", {
      name: `Expand project: ${name}`,
      exact: true,
    });
    const collapseProject = sidebar.getByRole("button", {
      name: `Collapse project: ${name}`,
      exact: true,
    });
    await expect(legacyCoordinator).toBeHidden();
    await expandProject.getByText(name, { exact: true }).click();
    await expect(collapseProject).toHaveAttribute("aria-expanded", "true");
    await expect(legacyCoordinator).toBeVisible();
    await expect(legacyCoordinator).toContainText("Set up project coordinator");
    await expect(
      page.locator("header").getByText(name, { exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.backchat.projectsList())).toEqual(
      [],
    );
    await legacyCoordinator.click();

    const project = sidebar.getByRole("link", {
      name: `Set up project coordinator: ${name}`,
      exact: true,
    });
    await expect(project).toHaveCount(1);
    await expect(legacyCoordinator).toHaveCount(0);
    await expect(project).toHaveAttribute("aria-current", "page");
    await expect(collapseProject).toHaveAttribute("aria-expanded", "true");
    await expect(collapseProject).not.toHaveAttribute("aria-current", "page");
    const saved = await page.evaluate(() => window.backchat.projectsList());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name,
      primary_folder: source,
      source_folders: [source],
    });
    await expect(
      sidebar.getByRole("button", {
        name: "Existing source conversation",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      sidebar.getByRole("button", {
        name: "Existing workspace conversation",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      sidebar.getByRole("button", {
        name: "Existing workspace conversation",
        exact: true,
      }),
    ).toBeVisible();
    const workspaceNode = sidebar.locator(
      '[data-sidebar-workspace="legacy-fix-workspace"]',
    );
    await expect(workspaceNode).toHaveCount(1);
    await expect(
      workspaceNode.getByRole("button", { name: "fix-abc", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", {
        name: "Existing workspace conversation",
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
    const coordinatorBox = (await project.boundingBox())!;
    const sourceBox = (await sidebar
      .getByRole("button", {
        name: "Existing source conversation",
        exact: true,
      })
      .boundingBox())!;
    const workspaceBox = (await workspaceNode.boundingBox())!;
    expect(coordinatorBox.y + coordinatorBox.height).toBeLessThanOrEqual(
      sourceBox.y,
    );
    expect(coordinatorBox.y + coordinatorBox.height).toBeLessThanOrEqual(
      workspaceBox.y,
    );
    await capture("legacy-project-promoted.png");

    await page.reload();
    await expect(project).toHaveCount(1);
    await expect(legacyCoordinator).toHaveCount(0);
    await expect(
      sidebar.getByRole("button", {
        name: "Existing source conversation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", {
        name: "Existing workspace conversation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(workspaceNode).toHaveCount(1);
    await project.click();
    expect(
      (await page.evaluate(() => window.backchat.projectsList())).map(
        (item) => item.id,
      ),
    ).toEqual([saved[0].id]);
    const persisted = await page.evaluate(async () => ({
      sessions: await window.backchat.sessionsList(),
      workspaces: await window.backchat.workspacesList(),
      sourceHistory:
        await window.backchat.sessionsLoadHistory("legacy-source-chat"),
      workspaceHistory: await window.backchat.sessionsLoadHistory(
        "legacy-workspace-chat",
      ),
    }));
    expect(persisted.sessions.map((session) => session.id).sort()).toEqual([
      "legacy-source-chat",
      "legacy-workspace-chat",
    ]);
    expect(
      persisted.workspaces.find(
        (workspace) => workspace.id === "legacy-fix-workspace",
      ),
    ).toMatchObject({
      project_id: null,
      name: "fix-abc",
      kind: "managed",
      branch: "fix-abc",
      roots,
      worktrees,
    });
    expect(
      persisted.sourceHistory.map((event) => ({
        type: event.type,
        data: JSON.parse(event.data),
      })),
    ).toEqual([
      { type: "user_prompt", data: { text: "Keep the source history" } },
    ]);
    expect(
      persisted.workspaceHistory.map((event) => ({
        type: event.type,
        data: JSON.parse(event.data),
      })),
    ).toEqual([
      { type: "user_prompt", data: { text: "Keep the workspace history" } },
    ]);
  });

  test("creates a durable project container from the sidebar", async ({
    page,
    bridge,
    capture,
  }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    await page.evaluate(async () => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({
        appearance: { ...current.appearance, theme: "dark" },
      });
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-mode",
      "dark",
    );
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create project" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Source folders", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Add folders OpenMA can read and edit",
      }),
    ).toBeVisible();

    await dialog
      .getByRole("textbox", { name: "Project name" })
      .fill("OpenMA workspace");
    await bridge.setPickedDirs([
      "/Users/demo/OpenMA/app",
      "/Users/demo/OpenMA/docs",
      "/Users/demo/OpenMA/backend",
    ]);
    await dialog
      .getByRole("button", {
        name: "Add folders OpenMA can read and edit",
      })
      .click();
    await expect(dialog.getByText("app", { exact: true })).toBeVisible();
    await expect(dialog.getByText("docs", { exact: true })).toBeVisible();
    await expect(dialog.getByText("backend", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Make primary" }).first().click();
    await expect(dialog.getByText("Primary", { exact: true })).toBeVisible();
    await capture(
      "create-project-multi-root.png",
      "Create project multi-root dialog",
    );
    await dialog.getByRole("button", { name: "Create project" }).click();

    await expect(
      page.getByRole("link", {
        name: "Set up project coordinator: OpenMA workspace",
        exact: true,
      }),
    ).toBeVisible();
  });
});
