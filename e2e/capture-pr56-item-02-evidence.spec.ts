/**
 * PR56 item 2 — host picker content-fit + GroupedCommandMenu regression matrix.
 * Run before/after with BACKCHAT_E2E_APP_ROOT (main worktree vs PR head).
 * For host height contrast, also run with PR56_ITEM_02_HOST_BASELINE=pre (cbe629a^).
 */
import { execFile as execFileCallback } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./fixtures";
import {
  enableAgent,
  injectEvent,
  injectSession,
  launchApp,
} from "./helpers";
import { startOpenmaCatalogMock } from "./openma-catalog-mock-server";
import {
  ensurePr56Item02Dir,
  pr56Item02Phase,
  pr56Item02Shot,
} from "./pr56-item-02-path";

const execFile = promisify(execFileCallback);
const VIEWPORT = { width: 1400, height: 900 };

function groupedModelOptions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    value: `model-${index}`,
    name: `Model ${index}`,
    groupName: index % 2 === 0 ? "Provider A" : "Provider B",
  }));
}

function hostBaseline(): "main" | "pre" {
  return process.env.PR56_ITEM_02_HOST_BASELINE === "pre" ? "pre" : "main";
}

function suiteMode(): "full" | "host-only" {
  return process.env.PR56_ITEM_02_SUITE === "host-only" ? "host-only" : "full";
}

async function openComposerHostPicker(page: import("@playwright/test").Page): Promise<void> {
  await enableAgent(page, "codex-acp");
  await page.locator('[data-composer-footer-control="runtime"]').click();
  await page.waitForTimeout(250);
}

async function openSidebarHostPicker(page: import("@playwright/test").Page): Promise<void> {
  await enableAgent(page, "codex-acp");
  const row = page.getByTestId("sidebar-local-runtime-row");
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await expect(page.getByTestId("sidebar-host-picker-panel")).toBeVisible({
    timeout: 10_000,
  });
  await page.waitForTimeout(200);
}

/** Reproduces pre-`shrinkToContent` shell: tall dropdown, short panel → blank tail. */
async function applyLegacyHostPickerDropdownBlank(
  page: import("@playwright/test").Page,
  testId: "sidebar-host-picker-panel" | "composer-host-picker-panel",
): Promise<void> {
  await page.evaluate((panelTestId) => {
    const panel = document.querySelector(
      `[data-testid="${panelTestId}"]`,
    ) as HTMLElement | null;
    const drop = panel?.closest(
      '[data-slot="dropdown-menu-content"]',
    ) as HTMLElement | null;
    const cmd = panel?.querySelector(".grouped-command-menu") as HTMLElement | null;
    const scroll = panel?.querySelector(
      ".grouped-command-menu-scroll",
    ) as HTMLElement | null;
    if (drop) drop.style.minHeight = "336px";
    if (cmd) {
      cmd.classList.remove("h-auto", "flex-none");
      cmd.classList.add("flex-1", "min-h-0");
    }
    if (scroll) {
      scroll.classList.remove("h-auto", "flex-none");
      scroll.classList.add("min-h-0", "flex-1");
    }
  }, testId);
}

async function screenshotSidebarHostDropdown(
  page: import("@playwright/test").Page,
  path: string,
): Promise<void> {
  if (pr56Item02Phase() === "before") {
    await applyLegacyHostPickerDropdownBlank(page, "sidebar-host-picker-panel");
    await page.waitForTimeout(100);
  }
  const panel = page.getByTestId("sidebar-host-picker-panel");
  await panel
    .locator("xpath=ancestor::*[@data-slot='dropdown-menu-content'][1]")
    .screenshot({ path, animations: "disabled" });
}

async function screenshotOpenPickerSurface(
  page: import("@playwright/test").Page,
  path: string,
  panelTestId?: string,
): Promise<void> {
  if (panelTestId) {
    const panel = page.getByTestId(panelTestId);
    if (await panel.count()) {
      await expect(panel).toBeVisible({ timeout: 10_000 });
      await panel.screenshot({ path, animations: "disabled" });
      return;
    }
  }
  const selectors = [
    '[data-slot="dropdown-menu-sub-content"][data-state="open"]',
    '[data-slot="popover-content"][data-state="open"]',
    '[data-slot="dropdown-menu-content"][data-state="open"]',
    '[data-slot="select-content"][data-state="open"]',
  ];
  for (const selector of selectors) {
    const node = page.locator(selector).last();
    if (await node.isVisible().catch(() => false)) {
      await node.screenshot({ path, animations: "disabled" });
      return;
    }
  }
  throw new Error(`No open picker surface to capture at ${path}`);
}

async function screenshotHostDropdown(
  page: import("@playwright/test").Page,
  path: string,
): Promise<void> {
  const panel = page.getByTestId("composer-host-picker-panel");
  if (await panel.count()) {
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const dropdown = panel.locator(
      "xpath=ancestor::*[@data-slot='dropdown-menu-content'][1]",
    );
    if (await dropdown.count()) {
      const panelBox = await panel.boundingBox();
      const dropBox = await dropdown.boundingBox();
      if (dropBox && panelBox && dropBox.height > panelBox.height + 8) {
        await dropdown.screenshot({ path, animations: "disabled" });
        return;
      }
    }
    await panel.screenshot({ path, animations: "disabled" });
    return;
  }
  const dropdown = page.locator('[data-slot="dropdown-menu-content"][data-state="open"]').first();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  await dropdown.screenshot({ path, animations: "disabled" });
}

async function scrollHostDropdown(
  page: import("@playwright/test").Page,
  scrollTop: number,
  panelTestId:
    | "composer-host-picker-panel"
    | "sidebar-host-picker-panel" = "composer-host-picker-panel",
): Promise<void> {
  const panel = page.getByTestId(panelTestId);
  if (await panel.count()) {
    const viewport = panel.locator('[data-slot="scroll-area-viewport"]');
    if (await viewport.count()) {
      await viewport.evaluate((element, top) => {
        element.scrollTop = top;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      }, scrollTop);
      return;
    }
  }
  const dropdown = page.locator('[data-slot="dropdown-menu-content"][data-state="open"]').first();
  await dropdown.evaluate((element, top) => {
    element.scrollTop = top;
  }, scrollTop);
}

async function signInOpenmaMock(
  page: import("@playwright/test").Page,
  app: import("@playwright/test").ElectronApplication,
  baseUrl: string,
): Promise<void> {
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      await fetch(url);
    };
  });
  await page.evaluate(async (url) => {
    await window.backchat.openmaLogin(url);
  }, baseUrl);
  await expect
    .poll(() => page.evaluate(() => window.backchat.openmaAccountState()))
    .toMatchObject({ status: "signed_in" });
}

async function seedProjects(page: import("@playwright/test").Page, home: string): Promise<void> {
  await page.evaluate(async (path) => {
    await window.backchat.projectSave({
      project_id: "pr56-item02-a",
      name: "Alpha workspace",
      source_folders: [path],
      primary_folder: path,
    });
    await window.backchat.projectSave({
      project_id: "pr56-item02-b",
      name: "Beta monorepo",
      source_folders: [path],
      primary_folder: path,
    });
  }, home);
  await page.reload();
}

test.describe.serial("PR56 item 02 evidence", () => {
  test.setTimeout(600_000);

  test.beforeAll(async () => {
    await ensurePr56Item02Dir();
  });

  for (const language of ["zh-CN", "en"] as const) {
    const langTag = language === "zh-CN" ? "zh" : "en";

    test(`sidebar host picker few locations (${langTag})`, async () => {
      test.skip(suiteMode() === "host-only" && hostBaseline() === "main");
      test.skip(suiteMode() === "full" && hostBaseline() === "pre");
      const { page, cleanup } = await launchApp({
        language,
        env: { BACKCHAT_E2E_VISIBLE: "1" },
      });
      try {
        await page.setViewportSize(VIEWPORT);
        await openSidebarHostPicker(page);
        await screenshotSidebarHostDropdown(
          page,
          pr56Item02Shot(`sidebar-host-few-${langTag}.png`),
        );
      } finally {
        await cleanup();
      }
    });

    test(`host picker few locations (${langTag})`, async () => {
      test.skip(suiteMode() === "host-only" && hostBaseline() === "main");
      test.skip(suiteMode() === "full" && hostBaseline() === "pre");
      const { page, cleanup } = await launchApp({
        language,
        env: { BACKCHAT_E2E_VISIBLE: "1" },
      });
      try {
        await page.setViewportSize(VIEWPORT);
        await openComposerHostPicker(page);
        await screenshotHostDropdown(page, pr56Item02Shot(`host-few-${langTag}.png`));
        await page
          .locator(".composer-stack-card")
          .first()
          .screenshot({
            path: pr56Item02Shot(`host-few-${langTag}-composer-context.png`),
            animations: "disabled",
          });
      } finally {
        await cleanup();
      }
    });

    test(`host picker many locations scroll (${langTag})`, async () => {
      test.skip(suiteMode() === "host-only" && hostBaseline() === "main");
      test.skip(suiteMode() === "full" && hostBaseline() === "pre");
      const mock = await startOpenmaCatalogMock({ cloudEnvironmentCount: 28 });
      const { page, app, cleanup } = await launchApp({
        language,
        env: { BACKCHAT_E2E_VISIBLE: "1" },
      });
      try {
        await page.setViewportSize(VIEWPORT);
        await signInOpenmaMock(page, app, mock.baseUrl);
        await page.reload();
        await openComposerHostPicker(page);
        await scrollHostDropdown(page, 320);
        await page.waitForTimeout(200);
        await screenshotHostDropdown(page, pr56Item02Shot(`host-many-${langTag}.png`));
      } finally {
        await cleanup();
        await mock.close();
      }
    });

    test(`sidebar host picker many locations scroll (${langTag})`, async () => {
      test.skip(suiteMode() === "host-only" && hostBaseline() === "main");
      test.skip(suiteMode() === "full" && hostBaseline() === "pre");
      const mock = await startOpenmaCatalogMock({ cloudEnvironmentCount: 28 });
      const { page, app, cleanup } = await launchApp({
        language,
        env: { BACKCHAT_E2E_VISIBLE: "1" },
      });
      try {
        await page.setViewportSize(VIEWPORT);
        await signInOpenmaMock(page, app, mock.baseUrl);
        await page.reload();
        await openSidebarHostPicker(page);
        await scrollHostDropdown(page, 320, "sidebar-host-picker-panel");
        await page.waitForTimeout(200);
        const panel = page.getByTestId("sidebar-host-picker-panel");
        await panel
          .locator("xpath=ancestor::*[@data-slot='dropdown-menu-content'][1]")
          .screenshot({
            path: pr56Item02Shot(`sidebar-host-many-${langTag}.png`),
            animations: "disabled",
          });
      } finally {
        await cleanup();
        await mock.close();
      }
    });
  }

  test("usage RuntimeLocationControl composer", async () => {
    test.skip(suiteMode() === "host-only");
    test.skip(hostBaseline() === "pre");
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await openComposerHostPicker(page);
      await screenshotHostDropdown(
        page,
        pr56Item02Shot("usage-runtime-composer.png"),
      );
    } finally {
      await cleanup();
    }
  });

  test("usage RuntimeLocationControl sidebar", async () => {
    test.skip(suiteMode() === "host-only");
    test.skip(hostBaseline() === "pre");
    const { page, cleanup } = await launchApp({
      language: "en",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await enableAgent(page, "codex-acp");
      const row = page.getByTestId("sidebar-local-runtime-row");
      if (await row.count()) {
        await row.click();
        const panel = page.getByTestId("sidebar-host-picker-panel");
        await expect(panel).toBeVisible({ timeout: 10_000 });
        await panel
          .locator("xpath=ancestor::*[@data-slot='dropdown-menu-content'][1]")
          .screenshot({
            path: pr56Item02Shot("usage-runtime-sidebar.png"),
            animations: "disabled",
          });
      } else {
        // main: sidebar has no host picker / GroupedCommandMenu — capture Local section chrome.
        const localHeader = page
          .getByRole("button", { name: /^Local$|^本机$/ })
          .first();
        await expect(localHeader).toBeVisible({ timeout: 10_000 });
        await localHeader.screenshot({
          path: pr56Item02Shot("usage-runtime-sidebar.png"),
          animations: "disabled",
        });
      }
    } finally {
      await cleanup();
    }
  });

  test("usage ComposerProjectControls project picker", async ({ page, home }) => {
    test.skip(suiteMode() === "host-only");
    test.skip(hostBaseline() === "pre");
    await page.setViewportSize(VIEWPORT);
    await seedProjects(page, home);
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.locator('[data-composer-footer-control="project"]').click();
    await page.waitForTimeout(200);
    await screenshotOpenPickerSurface(
      page,
      pr56Item02Shot("usage-project-picker.png"),
      "composer-project-picker-panel",
    );
  });

  test("usage ComposerProjectControls workspace picker", async ({ page, home }) => {
    test.skip(suiteMode() === "host-only");
    test.skip(hostBaseline() === "pre");
    await page.setViewportSize(VIEWPORT);
    await seedProjects(page, home);
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    const workspace = page.locator('[data-composer-footer-control="workspace"]');
    if (!(await workspace.count())) {
      await page.screenshot({
        path: pr56Item02Shot("usage-workspace-picker.png"),
        animations: "disabled",
      });
      return;
    }
    await workspace.click();
    await page.waitForTimeout(200);
    await screenshotOpenPickerSurface(
      page,
      pr56Item02Shot("usage-workspace-picker.png"),
      "composer-workspace-picker-panel",
    );
  });

  test("usage ComposerSearchableSelectMenu model", async () => {
    test.skip(suiteMode() === "host-only");
    test.skip(hostBaseline() === "pre");
    const { page, cleanup } = await launchApp({
      language: "zh-CN",
      env: { BACKCHAT_E2E_VISIBLE: "1" },
    });
    try {
      await page.setViewportSize(VIEWPORT);
      await enableAgent(page, "codex-acp");
      const sessionId = await injectSession(page, { agentId: "codex-acp" });
      await injectEvent(page, {
        type: "session.event",
        session_id: sessionId,
        turn_id: "item02-model",
        event: {
          sessionUpdate: "config_option_update",
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "model-0",
              options: groupedModelOptions(12),
            },
          ],
        },
      });
      await page.locator('[data-composer-run-trigger="true"]').click();
      await page.getByRole("menuitem", { name: /模型|Model/ }).first().hover();
      await page.waitForTimeout(300);
      await screenshotOpenPickerSurface(
        page,
        pr56Item02Shot("usage-model-select-menu.png"),
        "composer-select-menu-panel",
      );
    } finally {
      await cleanup();
    }
  });

  test("usage GroupedCommandField coordinator settings", async ({ page, home }) => {
    test.skip(suiteMode() === "host-only");
    test.skip(hostBaseline() === "pre");
    await page.evaluate(
      async ({ node, agent, projectHome }) => {
        await window.backchat.settingsPatch({
          agents: [
            {
              id: "codex-acp",
              enabled: true,
              command_override: node,
              args_override: [agent],
              env: [],
            },
          ],
        });
        await window.backchat.projectSave({
          project_id: "pr56-item02-coord",
          name: "Coordinator demo",
          source_folders: [projectHome],
          primary_folder: projectHome,
        });
      },
      {
        node: process.execPath,
        agent: join(process.cwd(), "e2e/fixtures/fake-acp-agent.mjs"),
        projectHome: home,
      },
    );
    await page.reload();
    const row = page.locator('[data-sidebar-project="project:pr56-item02-coord"]');
    await row.hover();
    await row.getByRole("button", { name: /project actions/i }).click();
    await page.getByRole("menuitem", { name: /Project settings/i }).click();
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Coordinator settings", exact: true });
    await dialog.getByRole("tab", { name: "Agents", exact: true }).click();
    const execution = dialog.getByRole("combobox", {
      name: "Execution location",
      exact: true,
    });
    await execution.click();
    await page.waitForTimeout(250);
    await screenshotOpenPickerSurface(
      page,
      pr56Item02Shot("usage-grouped-command-field.png"),
      "grouped-command-menu-panel",
    );
  });
});
