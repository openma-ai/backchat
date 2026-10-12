import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "./fixtures";
import { injectSession } from "./helpers";

interface LogEntry {
  event: string;
  errorId?: string;
  source?: string;
  message?: string;
  stack?: string;
  route?: string;
  session_id?: string;
  agent_id?: string;
  [key: string]: unknown;
}

function readAppLog(home: string): LogEntry[] {
  try {
    return readFileSync(join(home, "logs", "backchat.log"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEntry);
  } catch {
    return [];
  }
}

test.describe("renderer crash logging", () => {
  test("an uncaught renderer error shows the crash page error id and logs a matching entry", async ({
    page,
    home,
  }) => {
    const sessionId = await injectSession(page);

    // Force a genuine uncaught exception: window.onerror fires, the crash
    // fallback mounts, and the report is written to backchat.log over IPC.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("e2e forced renderer error");
      }, 0);
    });

    // The crash fallback shows the error id written to the log entry.
    const errorIdRow = page.locator("[data-renderer-crash-error-id]");
    await expect(errorIdRow).toBeVisible({ timeout: 15_000 });
    const errorId = (await errorIdRow.textContent())
      ?.replace(/^.*?([0-9a-f]{8}).*$/, "$1")
      .trim();
    expect(errorId).toMatch(/^[0-9a-f]{8}$/);
    await expect(page.locator("[data-renderer-crash-page]")).toBeVisible();

    // The same errorId is stamped on the structured app.renderer_crash entry.
    let entry: LogEntry | undefined;
    await expect
      .poll(
        () => {
          entry = readAppLog(home).find(
            (e) => e.event === "app.renderer_crash" && e.errorId === errorId,
          );
          return entry;
        },
        { timeout: 10_000 },
      )
      .toBeTruthy();

    expect(entry).toMatchObject({
      event: "app.renderer_crash",
      errorId,
      source: "window.onerror",
      route: `/chat/${sessionId}`,
      session_id: sessionId,
      agent_id: "claude-acp",
    });
    expect(entry?.message).toContain("e2e forced renderer error");
    expect(entry?.stack).toContain("e2e forced renderer error");
  });
});
