import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "./fixtures";

const execFile = promisify(execFileCallback);

test("a picked parent folder offers a workspace with a worktree per nested repository", async ({ page, app, home, capture }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
  const parent = join(home, "projects");
  for (const folder of ["app", "packages/docs"]) {
    const repo = join(parent, folder);
    await mkdir(repo, { recursive: true });
    await execFile("git", ["init", "--initial-branch=main", repo]);
    await writeFile(join(repo, "README.md"), folder);
    await execFile("git", ["-C", repo, "add", "."]);
    await execFile("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"]);
  }
  await execFile("git", ["-C", join(parent, "app"), "worktree", "add", "-b", "feature/nested", join(parent, "app-feature")]);
  await page.evaluate(source => window.backchat.workspaceCreate({ source_directory: source, name: "Partial app checkout" }), join(parent, "app"));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, parent);
  await page.evaluate(() => {
    const original = window.backchat.workspacesList;
    const gate = new Promise<void>(resolve => { (window as unknown as { releaseWorkspaceScan: () => void }).releaseWorkspaceScan = resolve; });
    window.backchat.workspacesList = async params => {
      if (params?.source_directory) await gate;
      return original(params);
    };
  });
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Browse/ }).click();
  await expect(page.locator('[data-composer-footer-control="project"]')).toContainText("projects");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const loading = page.getByRole("status", { name: "Loading project workspaces" });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveClass(/animate-spin/);
  await expect(loading).toHaveCSS("animation-iteration-count", "infinite");
  await capture("project-loading.png");
  await page.evaluate(() => (window as unknown as { releaseWorkspaceScan: () => void }).releaseWorkspaceScan());
  await expect(loading).toBeHidden();
  const workspace = page.locator('[data-composer-footer-control="workspace"]');
  await expect(workspace).toBeVisible();
  const introduction = page.getByRole("dialog", { name: "Work on tasks in parallel", exact: true });
  await expect(introduction).toBeVisible();
  await capture("workspace-introduction.png");
  await introduction.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(introduction).toBeHidden();
  const about = page.getByRole("button", { name: "About workspaces", exact: true });
  await expect(page.locator("[data-workspace-create-row]").getByRole("button", { name: "About workspaces" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Partial app checkout/ })).toHaveCount(0);
  await capture("workspace-help-placement.png");
  await about.click();
  await expect(introduction).toBeVisible();
  await introduction.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Workspace name", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New worktrees", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await workspace.click();
  await page.getByRole("option", { name: "New workspace…", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace name", exact: true }).fill("isolated-change");
  await expect(page.getByRole("button", { name: "New worktrees", exact: true })).toHaveAttribute("aria-pressed", "true");
  await capture("new-workspace-default.png");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(workspace).toContainText("isolated-change");
  const created = await page.evaluate(async () => (await window.backchat.workspacesList()).find(w => w.name === "isolated-change"));
  expect(created?.worktrees).toHaveLength(2);
  expect(created?.project_id).toBeTruthy();
  await expect(page.locator("[data-sidebar-workspace]").getByRole("button", { name: "isolated-change", exact: true })).toBeVisible();
  for (const tree of created!.worktrees) {
    expect(tree.path).not.toBe(tree.repoRoot);
    expect(await readFile(join(tree.path, "README.md"), "utf8")).toMatch(/^(app|packages\/docs)$/);
  }
  // Selecting another folder clears the previous workspace and hides the
  // creation control if that folder has no repositories.
  const empty = join(home, "empty");
  await mkdir(empty);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, empty);
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Browse/ }).click();
  await expect(page.locator('[data-composer-footer-control="project"]')).toContainText("empty");
  await expect(workspace).toHaveCount(0);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, parent);
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Browse/ }).click();
  await expect(workspace).toBeVisible();
  await expect(introduction).toBeHidden();
  await page.reload();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Browse/ }).click();
  await expect(workspace).toBeVisible();
  await expect(introduction).toBeHidden();
});

test("new-chat worktree choices auto-match branches but allow independent main and mixed selections", async ({ page, app, home, capture }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
  home = await realpath(home);
  const parent = join(home, "project");
  for (const folder of ["api", "web"]) {
    const repo = join(parent, folder);
    await mkdir(repo, { recursive: true });
    await execFile("git", ["init", "--initial-branch=main", repo]);
    await execFile("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "fixture"]);
    await execFile("git", ["-C", repo, "worktree", "add", "-b", "feature/shared", join(home, `${folder}-shared`)]);
  }
  await execFile("git", ["-C", join(parent, "api"), "worktree", "add", "-b", "fix/api-only", join(home, "api-fix")]);
  await page.evaluate(source => window.backchat.projectSave({ project_id: "existing-project", name: "Existing project", source_folders: [source] }), parent);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, parent);
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: /Browse/ }).click();
  const trigger = page.locator('[data-composer-footer-control="workspace"]');
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await page.getByRole("option", { name: "New workspace…", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace name", exact: true }).fill("Mixed work");
  await page.getByRole("button", { name: "Use existing", exact: true }).click();
  const api = page.getByRole("combobox", { name: "Worktree · api", exact: true });
  const web = page.getByRole("combobox", { name: "Worktree · web", exact: true });
  await api.click();
  await page.getByRole("option", { name: "feature/shared", exact: true }).click();
  await expect(web).toContainText("feature/shared");
  await web.click();
  await page.getByRole("option", { name: "main", exact: true }).click();
  await expect(api).toContainText("feature/shared");
  await expect(web).toContainText("main");
  // An explicit main choice remains pinned when the other repo changes.
  await api.click();
  await page.getByRole("option", { name: "fix/api-only", exact: true }).click();
  await expect(web).toContainText("main");
  await capture("combine-worktrees.png");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(trigger).toContainText("Mixed work");
  await capture("mixed-worktree-selection.png");
  const id = await trigger.getAttribute("data-workspace-id");
  const saved = await page.evaluate(async () => (await window.backchat.workspacesList()).filter(ws => ws.name === "Mixed work"));
  expect(saved).toHaveLength(1);
  expect(saved[0]?.kind).toBe("linked");
  expect(saved[0]?.project_id).toBe("existing-project");
  expect(await page.evaluate(async () => (await window.backchat.projectsList()).length)).toBe(1);
  expect(saved[0]?.worktrees.map(tree => tree.path)).toEqual([join(home, "api-fix"), join(parent, "web")]);
  await trigger.click();
  await expect(page.getByRole("option", { name: /Mixed work/ })).toBeVisible();
  await page.getByRole("option", { name: /^Local/ }).click();
  await expect(trigger).toContainText("Local");
  await trigger.click();
  await page.getByRole("option", { name: /Mixed work/ }).click();
  await expect(trigger).toContainText("Mixed work");
  await page.evaluate(async ({ nodePath, agentPath }) => {
    await window.backchat.settingsPatch({ agents: [{ id: "codex-acp", enabled: true, command_override: nodePath, args_override: [agentPath], env: [{ name: "BACKCHAT_FAKE_ADDITIONAL_DIRECTORIES", value: "1" }] }] });
  }, { nodePath: process.execPath, agentPath: resolve("e2e/fixtures/fake-acp-agent.mjs") });
  const started = await page.evaluate(({ cwd, id }) => window.backchat.sessionStart({ session_id: "mixed-workspace-check", agent_id: "codex-acp", cwd, workspace_mode: "worktree", workspace_id: id! }), { cwd: parent, id });
  expect(started.status, JSON.stringify(started)).toBe("ready");
  if (started.status === "ready") {
    expect(started.project_id).toBe("existing-project");
    expect(started.cwd).toBe(join(home, "api-fix"));
    expect(started.additional_directories).toEqual([join(parent, "web")]);
  }
  await page.evaluate(id => window.backchat.workspaceDelete({ workspace_id: id! }), id);
  // Removing a saved combination never removes the referenced checkouts.
  await execFile("git", ["-C", join(home, "api-fix"), "rev-parse", "HEAD"]);
  await execFile("git", ["-C", join(parent, "web"), "rev-parse", "HEAD"]);
});

test("new chats reuse the last selected project while an explicit empty choice stays empty", async ({ page, app, home }) => {
  const folder = join(home, "recent-project");
  await mkdir(folder);
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, folder);
  const project = page.locator('[data-composer-footer-control="project"]');
  await project.click();
  await page.getByRole("option", { name: /Browse/ }).click();
  await expect(project).toContainText("recent-project");
  await expect(page.getByRole("complementary").getByRole("button", { name: /^(Expand|Collapse) project: recent-project$/ })).toBeVisible();
  await page.getByTestId("new-chat-button").click();
  await expect(project).toContainText("recent-project");
  await project.click();
  await page.getByRole("option", { name: /No project/ }).click();
  await expect(project).toContainText("Choose project");
  await project.click();
  await page.keyboard.press("Escape");
  await expect(project).toContainText("Choose project");
  await page.getByTestId("new-chat-button").click();
  await expect(project).toContainText("recent-project");
});
