import { expect, test } from "./fixtures";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { enableAgent, injectEvent, injectSession, openTurnProcess } from "./helpers";
import { TestBridge } from "./test-bridge";

/**
 * README / website screenshots. Run on demand:
 *   pnpm exec electron-vite build && pnpm exec playwright test e2e/readme-screenshots.spec.ts
 * Writes artifacts/readme/*.png from a seeded, deterministic project + turn.
 */
const artifactDir = join(process.cwd(), "artifacts", "readme");

const APP_TS = `import { createServer } from "node:http";
import { loadConfig } from "./config";
import { router } from "./routes";

export async function start(port = 3000) {
  const config = await loadConfig();
  const server = createServer((req, res) => router(config, req, res));

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(\`listening on :\${port}\`);
  return server;
}

export function shutdown(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
`;

const CONFIG_TS = `export type Config = { port: number; logLevel: "info" | "debug" };

export async function loadConfig(): Promise<Config> {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(\`Invalid PORT: \${process.env.PORT}\`);
  }
  return { port, logLevel: process.env.DEBUG ? "debug" : "info" };
}
`;

const PROMPT = "Startup crashes when PORT is set to something invalid. Find the cause and make the error readable.";

async function seedWorkspace(home: string): Promise<string> {
  const root = join(home, "work", "backchat");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), APP_TS);
  await writeFile(join(root, "src", "config.ts"), CONFIG_TS);
  await writeFile(join(root, "src", "routes.ts"), "export function router() {}\n");
  await writeFile(join(root, "README.md"), "# backchat\n\nA tiny HTTP service.\n");
  await writeFile(join(root, "docs", "deploy.md"), "# Deploy\n");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "backchat-demo", version: "0.1.0", type: "module" }, null, 2) + "\n",
  );
  return root;
}

async function seedTurn(page: Page, sessionId: string, cwd: string) {
  const turnId = "turn-readme";
  const event = (update: Record<string, unknown>) =>
    injectEvent(page, { type: "session.event", session_id: sessionId, turn_id: turnId, event: update });

  await injectEvent(page, { type: "session.prompt", session_id: sessionId, turn_id: turnId, text: "" });
  await event({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "The config loader parses PORT; check how it validates before the server binds." },
  });
  await event({
    sessionUpdate: "tool_call",
    toolCallId: "t-grep",
    title: "rg -n \"PORT\" src",
    kind: "execute",
    status: "completed",
    rawInput: { command: "rg -n \"PORT\" src" },
    rawOutput: { output: "src/config.ts:4:  const port = Number(process.env.PORT ?? 3000);" },
  });
  await event({
    sessionUpdate: "tool_call",
    toolCallId: "t-read",
    title: "Read src/config.ts",
    kind: "read",
    status: "completed",
    locations: [{ path: join(cwd, "src", "config.ts") }],
    rawInput: { path: join(cwd, "src", "config.ts") },
  });
  await event({
    sessionUpdate: "tool_call",
    toolCallId: "t-edit",
    title: "Edit src/config.ts",
    kind: "edit",
    status: "completed",
    locations: [{ path: join(cwd, "src", "config.ts") }],
    content: [{
      type: "diff",
      path: join(cwd, "src", "config.ts"),
      oldText: "  const port = Number(process.env.PORT ?? 3000);\n",
      newText: "  const port = Number(process.env.PORT ?? 3000);\n  if (!Number.isInteger(port) || port <= 0) {\n    throw new Error(`Invalid PORT: ${process.env.PORT}`);\n  }\n",
    }],
  });
  await event({
    sessionUpdate: "tool_call",
    toolCallId: "t-test",
    title: "pnpm test",
    kind: "execute",
    status: "completed",
    rawInput: { command: "pnpm test" },
    rawOutput: { output: "✓ config.test.ts (4)\n\nTest Files  1 passed (1)\n     Tests  4 passed (4)" },
  });
  await event({
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: [
        "`loadConfig` turned any non-numeric `PORT` into `NaN`, and `server.listen(NaN)` failed later with an opaque `ERR_SOCKET_BAD_PORT`.",
        "",
        "I added validation right where the value is parsed:",
        "",
        "- `PORT=abc` now fails fast with **Invalid PORT: abc**",
        "- the default of `3000` is unchanged",
        "- `pnpm test` passes (4 tests)",
      ].join("\n"),
    },
  });
  await injectEvent(page, { type: "session.complete", session_id: sessionId, turn_id: turnId });
}

async function applyAppearance(page: Page, theme: "light" | "dark") {
  await page.evaluate(async (theme) => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, theme, language: "en" },
    });
  }, theme);
  await page.waitForTimeout(400);
}

async function settle(page: Page) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);
}

test("captures README screenshots", async ({ app, page, home }) => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900));
  await applyAppearance(page, "light");

  await enableAgent(page, "codex-acp");
  const cwd = await seedWorkspace(home);
  const sessionId = "readme-port";
  await new TestBridge(page).persistSessionFixture({
    sessionId,
    agentId: "codex-acp",
    cwd,
    acpSessionId: "acp-readme-port",
    title: "Fix crash on invalid PORT",
    events: [{ type: "user_prompt", data: { text: PROMPT } }],
  });
  await injectSession(page, { sessionId, agentId: "codex-acp", cwd });
  await expect(page.getByText(PROMPT, { exact: true })).toBeVisible();
  await injectEvent(page, { type: "session.retitled", session_id: sessionId, title: "Fix crash on invalid PORT" });
  await seedTurn(page, sessionId, cwd);
  await expect(page.getByText("Invalid PORT: abc").first()).toBeVisible();

  // 1) Activity: settled turn with the process disclosure open.
  await openTurnProcess(page);
  const summary = page.getByText(/^Ran commands/).first();
  if (await summary.isVisible().catch(() => false)) await summary.click();
  await settle(page);
  await page.screenshot({ path: join(artifactDir, "activity.png"), animations: "disabled" });

  // 2) Hero: the same conversation with a file previewed in the side panel.
  await page.getByRole("button", { name: "Open side panel" }).click();
  await page.locator('[data-new-action="file"]').click();
  const resizer = page.getByRole("separator", { name: "Resize side panel" }).or(page.getByLabel("Resize side panel")).first();
  const box = await resizer.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await page.getByText("src", { exact: true }).first().click();
  await page.getByText("app.ts", { exact: true }).first().click();
  await expect(page.locator(".file-preview-code").first()).toBeVisible({ timeout: 10_000 });
  await settle(page);
  await page.screenshot({ path: join(artifactDir, "hero.png"), animations: "disabled" });

  // 3) Dark theme of the hero layout.
  await applyAppearance(page, "dark");
  await settle(page);
  await page.screenshot({ path: join(artifactDir, "dark.png"), animations: "disabled" });
});
