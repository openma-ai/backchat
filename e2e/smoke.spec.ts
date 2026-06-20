import { expect, test } from "@playwright/test";
import { injectEvent, injectSession, launchApp } from "./helpers";

test.describe("backchat smoke", () => {
  test("e2e launch keeps the window hidden by default", async () => {
    const { app, cleanup } = await launchApp();
    try {
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some((win) => win.isVisible()),
          ),
        )
        .toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("empty state renders composer + sidebar chrome", async () => {
    const { page, cleanup } = await launchApp();
    try {
      // Sidebar chrome — New chat + Search rows.
      await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
      await expect(page.locator("button", { hasText: "Search" })).toBeVisible();

      // Empty-state title — only renders when no active session.
      await expect(page.getByText(/What can I help with\?|Pick a default agent/)).toBeVisible();
    } finally {
      await cleanup();
    }
  });

  test("injected session.ready surfaces in sidebar + topbar", async () => {
    const { page, cleanup } = await launchApp();
    try {
      await injectSession(page, { agentId: "claude-acp", cwd: "/tmp/wkspc" });

      // session.ready promotes the row from draft to ready and surfaces
      // its cwd on the topbar's CwdChip + the composer ProjectChipRow.
      // We assert one of them is visible — strictly identifying the
      // chip would require a test-id we don't have yet.
      const cwdChips = page.getByTitle("/tmp/wkspc");
      await expect(cwdChips.first()).toBeVisible();
      expect(await cwdChips.count()).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test("available_commands_update populates the slash picker", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);

      // ACP `available_commands_update` is a session-scoped event — the
      // store wires it onto SessionRow.availableCommands. Composer reads
      // that when the textarea starts with "/" and opens the picker.
      // session.event needs a turn_id field; we pass a dummy one because
      // the reducer's session-scoped branch ignores it.
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
            { name: "init", description: "Init a new project" },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/");

      // Picker pops as a listbox with both commands as options.
      await expect(page.getByRole("option", { name: /compact/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /init/i })).toBeVisible();
    } finally {
      await cleanup();
    }
  });

  test("composer model picker switches the active session config option", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "config_option_update",
          configOptions: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "gpt-5-mini",
              options: [
                { value: "gpt-5-mini", name: "GPT-5 mini" },
                { value: "gpt-5", name: "GPT-5" },
              ],
            },
          ],
        },
      });

      const modelPicker = page.getByTitle("Model");
      await expect(modelPicker).toContainText("GPT-5 mini");

      await modelPicker.click();
      await page.getByRole("menuitem", { name: /^GPT-5$/ }).click();

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionConfigOptions().then(
              (calls: Array<{ config_id: string; value: string }>) =>
                calls.map((p) => ({ config_id: p.config_id, value: p.value })),
            ),
          ),
        )
        .toEqual([{ config_id: "model", value: "gpt-5" }]);
      await expect(modelPicker).toContainText("GPT-5");
    } finally {
      await cleanup();
    }
  });

  test("enter on a no-argument slash command sends it as an ACP prompt", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);

      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
            {
              name: "init",
              description: "Init a new project",
              input: { hint: "project goal" },
            },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/com");
      await composer.press("Enter");

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (calls: Array<{ text: string }>) => calls.map((p) => p.text),
            ),
          ),
        )
        .toEqual(["/compact"]);
    } finally {
      await cleanup();
    }
  });

  test("escape dismisses the slash picker without editing the prompt", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/");
      await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeVisible();

      await composer.press("Escape");

      await expect(page.getByRole("listbox", { name: "Slash commands" })).toBeHidden();
      await expect(composer).toHaveValue("/");
    } finally {
      await cleanup();
    }
  });

  test("slash command filtering accepts compact abbreviations", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compact", description: "Compress this conversation" },
            { name: "init", description: "Init a new project" },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/cpt");

      await expect(page.getByRole("option", { name: /compact/i })).toBeVisible();
      await expect(page.getByRole("option", { name: /init/i })).toBeHidden();
    } finally {
      await cleanup();
    }
  });

  test("skill slash command renders as a composer chip and still sends ACP text", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await injectEvent(page, {
        type: "session.event",
        session_id: sid,
        turn_id: "dummy",
        event: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            {
              name: "impeccable",
              description: "Create distinctive, production-grade frontend interfaces",
              kind: "skill",
            },
          ],
        },
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.click();
      await composer.fill("/imp");
      await composer.press("Enter");

      const skillChip = page.getByRole("button", { name: "Skill Impeccable" });
      await expect(skillChip).toBeVisible();
      await expect
        .poll(() =>
          skillChip.evaluate((el) => getComputedStyle(el).backgroundColor),
        )
        .toBe("rgba(0, 0, 0, 0)");
      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (calls: Array<{ text: string }>) => calls.map((p) => p.text),
            ),
          ),
        )
        .toEqual([]);

      const instructionInput = page.locator('textarea[placeholder="Add instructions…"]');
      await instructionInput.fill("make the dashboard feel polished");
      await instructionInput.press("Enter");

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (calls: Array<{ text: string }>) => calls.map((p) => p.text),
            ),
          ),
        )
        .toEqual(["/impeccable make the dashboard feel polished"]);
    } finally {
      await cleanup();
    }
  });

  test("plus button attaches images and files to the ACP prompt", async () => {
    const { page, cleanup } = await launchApp();
    try {
      const sid = await injectSession(page);
      await page.evaluate(async () => {
        // @ts-expect-error — test bridge typed in preload/index.ts
        await window.__backchatTest.setPickedFiles([
          {
            id: "att-image",
            name: "dashboard.svg",
            path: "/tmp/backchat-test/dashboard.svg",
            uri: "file:///tmp/backchat-test/dashboard.svg",
            kind: "image",
            mimeType: "image/svg+xml",
            size: 179,
            data: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMmY4MGVkIi8+PGNpcmNsZSBjeD0iNDAiIGN5PSI0MCIgcj0iMjIiIGZpbGw9IiNmZmZmZmYiLz48L3N2Zz4=",
          },
          {
            id: "att-file",
            name: "notes.md",
            path: "/tmp/backchat-test/notes.md",
            uri: "file:///tmp/backchat-test/notes.md",
            kind: "file",
            mimeType: "text/markdown",
            size: 42,
          },
        ]);
      });

      await page.getByLabel("Attach files").click();

      await expect(page.getByRole("img", { name: "dashboard.svg" })).toBeVisible();
      await expect(page.locator('[aria-label="notes.md"]')).toBeVisible();
      await page.screenshot({
        path: "test-results/regression-proof/attachments-proof.png",
        fullPage: true,
      });

      const composer = page.locator('textarea[placeholder="Reply…"]');
      await composer.fill("review these inputs");
      await composer.press("Enter");

      await expect
        .poll(async () =>
          page.evaluate(() =>
            // @ts-expect-error — test bridge typed in preload/index.ts
            window.__backchatTest.readSessionPrompts().then(
              (
                calls: Array<{
                  text: string;
                  attachments?: Array<{ name: string; kind: string; mimeType?: string }>;
                }>,
              ) =>
                calls.map((p) => ({
                  text: p.text,
                  attachments: (p.attachments ?? []).map((a) => ({
                    name: a.name,
                    kind: a.kind,
                    mimeType: a.mimeType,
                  })),
                })),
            ),
          ),
        )
        .toEqual([
          {
            text: "review these inputs",
            attachments: [
              { name: "dashboard.svg", kind: "image", mimeType: "image/svg+xml" },
              { name: "notes.md", kind: "file", mimeType: "text/markdown" },
            ],
          },
        ]);
      await expect(page.locator('[aria-label="notes.md"]')).toBeHidden();
    } finally {
      await cleanup();
    }
  });
});
