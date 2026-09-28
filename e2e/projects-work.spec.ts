import { test, expect } from "./fixtures";
import { resolve, join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

test("project workspace saves instructions and runs durable coordinator and worker turns", async ({
  page,
  app,
  home,
}) => {
  const repo = join(home, "project-source");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args],
      { encoding: "utf8" },
    ).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Project test");
  git("config", "user.email", "project@example.com");
  await writeFile(join(repo, "file.txt"), "committed source");
  git("add", ".");
  git("commit", "-m", "base");
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, repo);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.webContents.setZoomFactor(1);
    window.setContentSize(1100, 760);
  });
  await page.evaluate(
    async ({ node, agent, capture }) => {
      await window.backchat.settingsPatch({
        agents: [
          {
            id: "codex-acp",
            enabled: true,
            command_override: node,
            args_override: [agent],
            env: [
              { name: "BACKCHAT_FAKE_CAPTURE_PROMPT", value: capture },
              { name: "BACKCHAT_FAKE_ADDITIONAL_DIRECTORIES", value: "1" },
            ],
          },
        ],
      });
    },
    {
      capture: join(home, "captured-prompts.jsonl"),
      node: process.execPath,
      agent: resolve("e2e/fixtures/fake-acp-agent.mjs"),
    },
  );
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Project name", { exact: true })
    .fill("Research workspace");
  await dialog
    .getByLabel("Goal (optional)", { exact: true })
    .fill("A durable project for reviewing findings");
  await expect(
    dialog.getByRole("button", { name: "Create project", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await dialog.screenshot({
    path: "artifacts/projects-work/create-form.png",
    scale: "css",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(800, 600),
  );
  await expect(
    dialog.getByRole("button", { name: "Create project", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await dialog.screenshot({
    path: "artifacts/projects-work/create-form-narrow.png",
    scale: "css",
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 760),
  );
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.locator("header").getByText("Research workspace", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "Research workspace" })
    .click();
  await page
    .getByRole("button", { name: "Set up coordinator", exact: true })
    .click();
  await expect(dialog.getByLabel("Goal", { exact: true })).toHaveValue(
    "A durable project for reviewing findings",
  );
  await dialog.getByRole("tab", { name: "Agents", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Coordinator agent", exact: true })
    .click();
  const search = page.getByRole("combobox", {
    name: "Search Coordinator agent",
    exact: true,
  });
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "Codex", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/projects-work/agent-picker.png" });
  await search.fill("no-such-agent");
  await expect(
    page.getByText("No matching options.", { exact: true }),
  ).toBeVisible();
  await search.fill("Codex");
  expect(
    (await page.locator('[data-slot="popover-content"]').boundingBox())!.height,
  ).toBeLessThanOrEqual(330);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await dialog
    .getByRole("combobox", { name: "Worker agent", exact: true })
    .click();
  await page.getByRole("option", { name: /Codex/ }).click();
  const tabBar = await dialog.getByRole("tablist").boundingBox();
  const agentPicker = await dialog
    .getByRole("combobox", { name: "Coordinator agent", exact: true })
    .boundingBox();
  expect(tabBar!.height).toBeLessThan(60);
  expect(agentPicker!.y).toBeGreaterThan(tabBar!.y + tabBar!.height);
  await dialog.screenshot({
    path: "artifacts/projects-work/settings-agents.png",
    scale: "css",
  });
  await dialog.getByRole("tab", { name: "Context", exact: true }).click();
  await dialog.getByRole("button", { name: /^Add folders/ }).click();
  await expect(dialog.getByText(repo, { exact: true })).toBeVisible();
  await dialog
    .getByLabel("Instructions", { exact: true })
    .fill("Explain the evidence");
  await expect(
    dialog.getByRole("button", { name: "Save project", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await dialog.screenshot({
    path: "artifacts/projects-work/settings-context.png",
    scale: "css",
  });
  await dialog
    .getByRole("button", { name: "Save project", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Back to projects", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("What shall we work on?", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".projects-page header")).toHaveCount(0);
  await expect(
    page.locator("header").filter({
      has: page.getByRole("button", { name: "Tasks", exact: true }),
    }),
  ).toContainText("Research workspace");
  await expect(page.locator(".project-side-panel")).toHaveCount(0);
  await expect(
    page.getByLabel("Message coordinator", { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  const projectChrome = page.locator("header").filter({
    has: page.getByRole("button", { name: "Tasks", exact: true }),
  });
  await expect(
    projectChrome.getByText("Research workspace", { exact: false }),
  ).toBeInViewport({ ratio: 1 });
  await expect(page.locator("aside").first()).toHaveCSS("opacity", "0");
  await page.screenshot({
    path: "artifacts/projects-work/conversation-collapsed.png",
    scale: "css",
  });
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await expect(page.locator("aside").first()).toHaveCSS("opacity", "1");
  const sidebar = page.getByRole("complementary").first();
  const projectLink = sidebar.getByRole("link", {
    name: "Open project coordinator: Research workspace",
    exact: true,
  });
  await expect(projectLink).toBeVisible();
  await expect(projectLink).toHaveAttribute("aria-current", "page");
  await expect(projectLink.getByTitle("Codex", { exact: true })).toBeVisible();
  expect(
    await projectLink
      .locator("xpath=ancestor::li[1]")
      .evaluate((row) => row.previousElementSibling === null),
  ).toBe(true);
  await expect(
    sidebar.getByText("Project coordinator", { exact: true }),
  ).toHaveCount(1);
  await expect(sidebar.getByText("Tasks", { exact: true })).toHaveCount(0);
  await expect(projectChrome).not.toContainText("Project coordinator");
  await expect(projectChrome).not.toContainText(
    "A durable project for reviewing findings",
  );
  await page.screenshot({
    path: "artifacts/projects-work/conversation-ready.png",
    scale: "css",
  });
  const imagePath = join(home, "sample.png");
  const imageData =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VQAAAABJRU5ErkJggg==";
  await writeFile(imagePath, Buffer.from(imageData, "base64"));
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
    },
    [join(repo, "file.txt"), imagePath],
  );
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await expect(page.getByLabel("file.txt", { exact: true })).toBeVisible();
  await page
    .getByLabel("Message coordinator", { exact: true })
    .fill("Say hello");
  const composer = page.getByLabel("Message coordinator", { exact: true });
  await expect(composer).toHaveCSS("resize", "none");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("Say hello\n");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const p = (await window.backchat.projectsList()).find(
            (p) => p.name === "Research workspace",
          )!;
          return (
            await window.backchat.projectWorkView(p.id)
          ).facts.turns.filter((t) => t.state === "completed").length;
        }),
      { timeout: 30000 },
    )
    .toBe(1);
  const coordinatorIds = await page.evaluate(async () => {
    const project = (await window.backchat.projectsList()).find(
      (p) => p.name === "Research workspace",
    )!;
    return (await window.backchat.projectWorkView(project.id)).facts.sessions
      .filter((session) => session.agentId === "coordinator")
      .map((session) => session.id);
  });
  expect(coordinatorIds).toHaveLength(1);
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  const projectIndexHeading = page.getByRole("heading", {
    name: "Projects",
    exact: true,
  });
  await expect(projectIndexHeading).toBeVisible();
  await expect(
    page.locator(".project-card").filter({ hasText: "Research workspace" }),
  ).toHaveAttribute("href", (await projectLink.getAttribute("href"))!);
  // Visiting from the project index reveals its coordinator child. Folder
  // disclosure then stays independent from navigation, including while active.
  const expandProject = sidebar.getByRole("button", {
    name: "Expand project: Research workspace",
    exact: true,
  });
  const collapseProject = sidebar.getByRole("button", {
    name: "Collapse project: Research workspace",
    exact: true,
  });
  await expect(collapseProject).toHaveAttribute("aria-expanded", "true");
  await collapseProject
    .getByText("Research workspace", { exact: true })
    .click();
  await expect(expandProject).toHaveAttribute("aria-expanded", "false");
  await expect(projectLink).toBeHidden();
  await expect(projectIndexHeading).toBeVisible();
  await expandProject.getByText("Research workspace", { exact: true }).click();
  await expect(projectLink).toBeVisible();
  await expect(projectLink).not.toHaveAttribute("aria-current", "page");
  await expect(projectIndexHeading).toBeVisible();
  await projectLink.click();
  await expect(projectLink).toHaveAttribute("aria-current", "page");
  await expect(collapseProject).toHaveAttribute("aria-expanded", "true");
  await expect(collapseProject).not.toHaveAttribute("aria-current", "page");
  await expect(
    projectChrome.getByText("Research workspace", { exact: true }),
  ).toBeVisible();
  await expect(projectIndexHeading).toHaveCount(0);
  await collapseProject
    .getByText("Research workspace", { exact: true })
    .click();
  await expect(expandProject).toHaveAttribute("aria-expanded", "false");
  await expect(projectLink).toBeHidden();
  await expect(
    projectChrome.getByText("Research workspace", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(projectIndexHeading).toBeVisible();
  await page
    .locator(".project-card")
    .filter({ hasText: "Research workspace" })
    .click();
  await expect(collapseProject).toHaveAttribute("aria-expanded", "true");
  await expect(projectLink).toHaveAttribute("aria-current", "page");
  await expect(
    projectChrome.getByText("Research workspace", { exact: true }),
  ).toBeVisible();
  await expect(projectIndexHeading).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const project = (await window.backchat.projectsList()).find(
        (p) => p.name === "Research workspace",
      )!;
      const view = await window.backchat.projectWorkView(project.id);
      return {
        ids: view.facts.sessions
          .filter((session) => session.agentId === "coordinator")
          .map((session) => session.id),
        turns: view.facts.turns.length,
      };
    }),
  ).toEqual({ ids: coordinatorIds, turns: 1 });
  const captured = JSON.parse(
    (await readFile(join(home, "captured-prompts.jsonl"), "utf8"))
      .trim()
      .split("\n")[0],
  );
  expect(captured).toContainEqual(
    expect.objectContaining({
      type: "image",
      data: imageData,
      mimeType: "image/png",
    }),
  );
  const fileBlock = captured.find(
    (b: { type: string; name?: string }) =>
      b.type === "resource_link" && b.name === "file.txt",
  );
  expect(await readFile(new URL(fileBlock.uri), "utf8")).toBe(
    "committed source",
  );
  await expect(
    page.getByRole("link", { name: "file.txt", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page
    .getByRole("button", { name: "Delegate task", exact: true })
    .click();
  const delegation = page.getByRole("dialog");
  await delegation.getByLabel("Worker ID").fill("research-123");
  await delegation.getByLabel("Task").fill("Review the findings");
  await delegation
    .getByRole("button", { name: "Delegate", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const p = (await window.backchat.projectsList()).find(
            (p) => p.name === "Research workspace",
          )!;
          return (
            await window.backchat.projectWorkView(p.id)
          ).facts.turns.filter((t) => t.state === "completed").length;
        }),
      { timeout: 30000 },
    )
    .toBe(3);
  await expect(page.getByText("research-123", { exact: true })).toBeVisible();
  const bindings = await page.evaluate(async () => {
    const project = (await window.backchat.projectsList()).find(
      (p) => p.name === "Research workspace",
    )!;
    return (await window.backchat.projectWorkView(project.id)).workspaces!;
  });
  expect(bindings).toHaveLength(2);
  const worker = bindings.find((w) => w.workThreadId.includes(":worker:"))!;
  const location = worker.location as { cwd: string; branch: string };
  expect(location.cwd).not.toBe(repo);
  expect(
    execFileSync("git", ["-C", location.cwd, "branch", "--show-current"], {
      encoding: "utf8",
    }).trim(),
  ).toBe(worker.branch);
  expect(await readFile(join(location.cwd, "file.txt"), "utf8")).toBe(
    "committed source",
  );
  expect(git("branch", "--show-current")).toBe("main");
  await page.getByText(`Workspace · ${worker.branch}`, { exact: true }).click();
  await expect(page.getByText(location.cwd, { exact: true })).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Edit project", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await page
      .locator(".projects-page")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    await page
      .locator(".project-side-panel")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    await page
      .locator(".project-transcript")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/projects-work/desktop.png",
    fullPage: true,
    scale: "css",
  });
  await page.getByRole("button", { name: "View thread", exact: true }).click();
  await expect(
    page.getByLabel("Message worker", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Message coordinator", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".project-thread-transcript")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page
    .locator(".project-thread-detail")
    .getByRole("button", { name: "Attach files", exact: true })
    .click();
  await page.getByLabel("Message worker", { exact: true }).fill("");
  await page.getByLabel("Message worker", { exact: true }).press("Enter");
  await expect(page.getByLabel("Message worker", { exact: true })).toHaveValue(
    "",
  );
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const project = (await window.backchat.projectsList()).find(
          (p) => p.name === "Research workspace",
        )!;
        return (
          await window.backchat.projectWorkView(project.id)
        ).facts.turns.filter((turn) => turn.state === "completed").length;
      }),
    )
    .toBe(5);
  await page.screenshot({
    path: "artifacts/projects-work/worker-thread.png",
    scale: "css",
  });
  await page.reload();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ hasText: "Research workspace" })
    .click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Threads", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "Threads", exact: true }),
  ).toHaveAttribute("aria-selected", "false");
  await expect(
    page.getByText("Explain the evidence", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Activity history", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Threads", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Threads", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("research-123", { exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(800, 760),
  );
  await expect(
    page.getByRole("button", { name: "Edit project", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await page
      .locator(".projects-page")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/projects-work/narrow.png",
    fullPage: true,
    scale: "css",
  });
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Research workspace/ }),
  ).toHaveCount(0);
});
