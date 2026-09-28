import { test, expect } from "./fixtures";
import { injectSession } from "./helpers";

test("starting from a legacy workspace keeps its parent project and workspace selected", async ({ page, app, home }) => {
  const parent = `${home}/hilo-agent-opencode`;
  const checkout = `${home}/worktrees/fix-abc/01-backend`;
  await app.evaluate(({ ipcMain }, { parent, checkout }) => {
    ipcMain.removeHandler("workspaces:list");
    ipcMain.handle("workspaces:list", () => [{
      id: "fix-abc", project_id: null, name: "fix-abc", kind: "managed", branch: "fix-abc",
      roots: [{ sourcePath: `${parent}/backend`, effectivePath: checkout, worktreeIndex: 0 }],
      worktrees: [{ repoRoot: `${parent}/backend`, path: checkout, head: "abc123", branch: "fix-abc" }],
      created_by_session_id: null, created_at: 1, updated_at: 1,
    }, {
      id: "live:hilo", project_id: null, name: "Local", kind: "live", branch: "main",
      roots: [{ sourcePath: `${parent}/backend`, effectivePath: `${parent}/backend`, worktreeIndex: 0 }],
      worktrees: [{ repoRoot: `${parent}/backend`, path: `${parent}/backend`, head: "abc123", branch: "main" }],
      created_by_session_id: null, created_at: 1, updated_at: 1,
    }]);
  }, { parent, checkout });
  await page.reload();
  await injectSession(page, { agentId: "codex-acp", cwd: parent });
  const workspace = page.locator('[data-sidebar-workspace="fix-abc"]');
  await expect(workspace).toBeVisible();
  await workspace.hover();
  await workspace.getByRole("button", { name: "New chat in workspace", exact: true }).click();
  await expect(page.locator('[data-composer-footer-control="project"]')).toContainText("hilo-agent-opencode");
  await expect(page.locator('[data-composer-footer-control="project"]')).toHaveAttribute("title", parent);
  const selected = page.locator('[data-composer-footer-control="workspace"]');
  await expect(selected).toHaveAttribute("data-workspace-id", "fix-abc");
  await expect(selected).toContainText("fix-abc");
});
