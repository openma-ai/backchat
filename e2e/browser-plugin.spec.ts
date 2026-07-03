import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { injectSession, launchApp } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const execFileAsync = promisify(execFile);

test.describe("Browser plugin", () => {
  test("drives a local fixture through the in-app Browser IPC surface", async () => {
    const server = await startFixtureServer();
    const { page, cleanup } = await launchApp();
    const url = `http://127.0.0.1:${server.port}/fixture`;
    try {
      await injectSession(page);
      const result = await page.evaluate(async (fixtureUrl) => {
        const api = (window as unknown as { backchat: Record<string, (...args: unknown[]) => Promise<unknown>> }).backchat;
        const browser = await api.browserGet({ browser: "iab" });
        const named = await api.browserNameSession({
          browser: "iab",
          name: "Fixture checkout",
        });
        const sessionName = await api.browserSessionName({ browser: "iab" });
        const selectedBeforeCreate = await api.browserSelectedTab({ browser: "iab" });
        const userOpenTabs = await api.browserUserOpenTabs({ browser: "iab" });
        const tab = await api.browserNewTab({ browser: "iab" }) as { id: string };
        const tabById = await api.browserGetTab({ browser: "iab", tabId: tab.id });
        const selectedAfterCreate = await api.browserSelectedTab({ browser: "iab" });
        await api.browserGoto({ browser: "iab", tabId: tab.id, url: fixtureUrl });
        const selectedAfterExplicitSelect = await api.browserSelectTab({
          browser: "iab",
          tabId: tab.id,
        });
        const waitedUrl = await api.browserWaitForURL({
          browser: "iab",
          tabId: tab.id,
          url: fixtureUrl,
          waitUntil: "domcontentloaded",
          timeoutMs: 5_000,
        });

        await api.browserType({
          browser: "iab",
          tabId: tab.id,
          selector: "#name",
          text: "Ada",
        });
        await api.browserClick({
          browser: "iab",
          tabId: tab.id,
          selector: "#ping",
        });
        const valueAfterCssInput = await api.browserEvaluate({
          browser: "iab",
          tabId: tab.id,
          expression: "document.querySelector('#result').textContent",
        });

        const domSnapshot = await api.browserDomSnapshot({
          browser: "iab",
          tabId: tab.id,
        });
        const domCuaSnapshot = await api.browserDomCuaSnapshot({
          browser: "iab",
          tabId: tab.id,
        }) as string;
        const pingNodeId = /<button[^>]*node_id="([^"]+)"[^>]*>Ping<\/button>/
          .exec(domCuaSnapshot)?.[1];
        if (!pingNodeId) throw new Error(`Ping button missing from DOM CUA snapshot: ${domCuaSnapshot}`);
        await api.browserDomCuaClick({
          browser: "iab",
          tabId: tab.id,
          nodeId: pingNodeId,
        });
        const valueAfterDomCua = await api.browserEvaluate({
          browser: "iab",
          tabId: tab.id,
          expression: "document.querySelector('#result').textContent",
        });

        const rect = await api.browserEvaluate({
          browser: "iab",
          tabId: tab.id,
          expression: `(() => {
            const rect = document.querySelector('#ping').getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()`,
        }) as { x: number; y: number };
        await api.browserCuaClick({
          browser: "iab",
          tabId: tab.id,
          x: rect.x,
          y: rect.y,
        });
        const valueAfterCoordinateCua = await api.browserEvaluate({
          browser: "iab",
          tabId: tab.id,
          expression: "document.querySelector('#result').textContent",
        });

        const logs = await api.browserDevLogs({ browser: "iab", tabId: tab.id }) as Array<{
          level: string;
          message: string;
        }>;
        const assets = await api.browserPageAssets({ browser: "iab", tabId: tab.id }) as Array<{
          url: string;
          type: string;
        }>;
        const screenshot = await api.browserScreenshot({ browser: "iab", tabId: tab.id }) as {
          base64: string;
          mimeType: string;
        };
        await api.browserSetVisibility({ browser: "iab", visible: true });

        return {
          browser,
          named,
          sessionName,
          selectedBeforeCreate,
          userOpenTabs,
          tabId: tab.id,
          tabById,
          selectedAfterCreate,
          selectedAfterExplicitSelect,
          waitedUrl,
          valueAfterCssInput,
          domSnapshot,
          domCuaSnapshot,
          valueAfterDomCua,
          valueAfterCoordinateCua,
          logs,
          assets,
          screenshot,
        };
      }, url);

      expect(result.named).toEqual({ browser: "backchat-iab", name: "Fixture checkout" });
      expect(result.browser).toMatchObject({ id: "backchat-iab", type: "iab" });
      expect(result.sessionName).toBe("Fixture checkout");
      expect(result.selectedBeforeCreate).toBeNull();
      expect(result.userOpenTabs).toEqual([]);
      expect(result.tabById).toMatchObject({ id: result.tabId });
      expect(result.selectedAfterCreate).toMatchObject({ id: result.tabId });
      expect(result.selectedAfterExplicitSelect).toMatchObject({ id: result.tabId, url });
      expect(result.waitedUrl).toMatchObject({ url });
      expect(result.valueAfterCssInput).toBe("Ada:1");
      expect(result.domSnapshot).toContain("Backchat Browser Fixture");
      expect(result.domCuaSnapshot).toContain('node_id="1"');
      expect(result.domCuaSnapshot).toContain("Ping");
      expect(result.valueAfterDomCua).toBe("Ada:2");
      expect(result.valueAfterCoordinateCua).toBe("Ada:3");
      expect(result.logs.some((entry) => entry.message.includes("fixture-ready"))).toBe(true);
      expect(result.assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "script", url: expect.stringContaining("/fixture.js") }),
        ]),
      );
      expect(result.screenshot.mimeType).toMatch(/^image\//);
      expect(result.screenshot.base64.length).toBeGreaterThan(100);
      await expect(page.getByText(url, { exact: true })).toBeVisible();
    } finally {
      await cleanup();
      await server.close();
    }
  });

  test("blocks data and file URLs through the production Browser IPC surface", async () => {
    const { page, cleanup } = await launchApp();
    try {
      await injectSession(page);
      const attempts = await page.evaluate(async () => {
        const api = (window as unknown as { backchat: Record<string, (...args: unknown[]) => Promise<unknown>> }).backchat;
        const tab = await api.browserNewTab({ browser: "iab" }) as { id: string };
        const urls = [
          "data:text/html,blocked",
          "file:///Users/xiaoyang/Proj/backchat/package.json",
        ];
        const results: Array<{ url: string; ok: boolean; message?: string }> = [];
        for (const url of urls) {
          try {
            await api.browserGoto({ browser: "iab", tabId: tab.id, url });
            results.push({ url, ok: true });
          } catch (error) {
            results.push({
              url,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return results;
      });

      expect(attempts).toEqual([
        expect.objectContaining({
          url: "data:text/html,blocked",
          ok: false,
          message: expect.stringContaining("blocked protocol: data:"),
        }),
        expect.objectContaining({
          url: "file:///Users/xiaoyang/Proj/backchat/package.json",
          ok: false,
          message: expect.stringContaining("blocked protocol: file:"),
        }),
      ]);
    } finally {
      await cleanup();
    }
  });

  test.skip("drives a local fixture through the Chrome extension bridge", async () => {
    test.setTimeout(120_000);
    await execFileAsync("pnpm", ["exec", "tsx", "e2e/chrome-extension-harness.ts"], {
      cwd: repoRoot,
      env: cleanHarnessEnv(),
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
  });
});

function cleanHarnessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("PLAYWRIGHT_") ||
      key.startsWith("PW_TEST") ||
      key === "TEST_WORKER_INDEX"
    ) {
      delete env[key];
    }
  }
  return env;
}

async function startFixtureServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createHttpServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end("console.log('fixture-ready');");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html>
      <html>
        <head>
          <title>Backchat Browser Fixture</title>
          <script src="/fixture.js"></script>
          <style>
            body { margin: 0; padding: 24px; font-family: sans-serif; }
            button, input { font: inherit; margin: 8px 0; }
            #ping { position: fixed; left: 120px; top: 96px; }
          </style>
        </head>
        <body>
          <main>
            <h1>Backchat Browser Fixture</h1>
            <label>Name <input id="name" aria-label="Name" /></label>
            <button id="ping">Ping</button>
            <output id="result">idle</output>
          </main>
          <script>
            let count = 0;
            document.querySelector("#ping").addEventListener("click", () => {
              count += 1;
              document.querySelector("#result").textContent =
                document.querySelector("#name").value + ":" + count;
            });
          </script>
        </body>
      </html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
