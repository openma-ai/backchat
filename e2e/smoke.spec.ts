import { expect, test } from "@playwright/test";
import { injectEvent, injectSession, launchApp } from "./helpers";

test.describe("backchat smoke", () => {
  test("empty state renders composer + sidebar chrome", async () => {
    const { app, page } = await launchApp();
    try {
      // Sidebar chrome — New chat + Search rows.
      await expect(page.locator("button", { hasText: "New chat" })).toBeVisible();
      await expect(page.locator("button", { hasText: "Search" })).toBeVisible();

      // Empty-state title — only renders when no active session.
      await expect(page.getByText("What can I help with?")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("injected session.ready surfaces in sidebar + topbar", async () => {
    const { app, page } = await launchApp();
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
      await app.close();
    }
  });

  test("available_commands_update populates the slash picker", async () => {
    const { app, page } = await launchApp();
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
      await app.close();
    }
  });
});
