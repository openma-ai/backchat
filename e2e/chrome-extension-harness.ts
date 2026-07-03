import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchApp } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const extensionDir = join(repoRoot, "packages/browser-extension");

async function main(): Promise<void> {
  const frameServer = await startFrameFixtureServer();
  const server = await startFixtureServer(frameServer.port);
  const { page, cleanup } = await launchApp({
    env: { BACKCHAT_BROWSER_EXTENSION_PORT: "0" },
  });
  const bridgePort = await resolveChromeBridgePort(page);
  const chrome = await launchChromiumWithBackchatExtension(bridgePort);
  const url = `http://127.0.0.1:${server.port}/fixture`;
  try {
    await expect.poll(() => chromeBridgeConnected(page), {
      intervals: [1_000],
      timeout: 45_000,
    }).toBe(true);

    const result = await page.evaluate(async (fixtureUrl) => {
      const api = (window as unknown as { backchat: Record<string, (...args: unknown[]) => Promise<unknown>> }).backchat;
      const tab = await api.browserNewTab({ browser: "chrome" }) as { id: string };
      await api.browserGoto({ browser: "chrome", tabId: tab.id, url: fixtureUrl });
      await api.browserType({
        browser: "chrome",
        tabId: tab.id,
        selector: "#name",
        text: "Ada",
      });
      await api.browserClick({
        browser: "chrome",
        tabId: tab.id,
        selector: "#ping",
      });
      const valueAfterClick = await api.browserEvaluate({
        browser: "chrome",
        tabId: tab.id,
        expression: "document.querySelector('#result').textContent",
      });
      await api.browserLocatorClick({
        browser: "chrome",
        tabId: tab.id,
        locator: { kind: "testId", value: "trusted-locator" },
      });
      const trustedLocatorResult = await api.browserEvaluate({
        browser: "chrome",
        tabId: tab.id,
        expression: "document.querySelector('#trusted-result').textContent",
      });
      const domCuaSnapshot = await api.browserDomCuaSnapshot({
        browser: "chrome",
        tabId: tab.id,
      }) as string;
      const domCuaNodeId = domCuaSnapshot.match(/node_id="(\d+)">Trusted DOM CUA/)?.[1];
      if (!domCuaNodeId) {
        throw new Error(`Trusted DOM CUA node missing from snapshot: ${domCuaSnapshot}`);
      }
      await api.browserDomCuaClick({
        browser: "chrome",
        tabId: tab.id,
        nodeId: domCuaNodeId,
      });
      const trustedDomCuaResult = await api.browserEvaluate({
        browser: "chrome",
        tabId: tab.id,
        expression: "document.querySelector('#dom-cua-result').textContent",
      });
      const snapshot = await api.browserDomSnapshot({
        browser: "chrome",
        tabId: tab.id,
      });
      const screenshot = await api.browserScreenshot({ browser: "chrome", tabId: tab.id }) as {
        base64: string;
        mimeType: string;
      };
      const crossOriginFrameLocator = {
        kind: "frame",
        frame: { kind: "testId", value: "remote-frame" },
        locator: { kind: "testId", value: "remote-ping" },
      };
      let frameButtonCount: unknown;
      try {
        frameButtonCount = await api.browserLocatorCount({
          browser: "chrome",
          tabId: tab.id,
          locator: crossOriginFrameLocator,
        });
      } catch (error) {
        throw new Error(`remote frame count: ${String((error as Error)?.message ?? error)}`);
      }
      try {
        await api.browserLocatorClick({
          browser: "chrome",
          tabId: tab.id,
          locator: crossOriginFrameLocator,
        });
      } catch (error) {
        throw new Error(`remote frame click: ${String((error as Error)?.message ?? error)}`);
      }
      let frameResultText: unknown;
      try {
        frameResultText = await api.browserLocatorInnerText({
          browser: "chrome",
          tabId: tab.id,
          locator: {
            kind: "frame",
            frame: { kind: "testId", value: "remote-frame" },
            locator: { kind: "testId", value: "remote-result" },
          },
        });
      } catch (error) {
        throw new Error(`remote frame result: ${String((error as Error)?.message ?? error)}`);
      }
      const duplicateSecondFrameLocator = {
        kind: "frame",
        frame: { kind: "testId", value: "duplicate-frame", index: 1 },
        locator: { kind: "testId", value: "duplicate-ping" },
      };
      const duplicateFrameElementCount = await api.browserLocatorCount({
        browser: "chrome",
        tabId: tab.id,
        locator: { kind: "testId", value: "duplicate-frame" },
      });
      const duplicateSecondFrameSrc = await api.browserLocatorAttribute({
        browser: "chrome",
        tabId: tab.id,
        locator: { kind: "testId", value: "duplicate-frame", index: 1 },
        name: "src",
      });
      try {
        await api.browserLocatorClick({
          browser: "chrome",
          tabId: tab.id,
          locator: duplicateSecondFrameLocator,
        });
      } catch (error) {
        throw new Error(
          `duplicate second frame click ` +
          `(frame count ${String(duplicateFrameElementCount)}, src ${String(duplicateSecondFrameSrc)}): ` +
          String((error as Error)?.message ?? error),
        );
      }
      let duplicateFirstFrameText: unknown;
      try {
        duplicateFirstFrameText = await api.browserLocatorInnerText({
          browser: "chrome",
          tabId: tab.id,
          locator: {
            kind: "frame",
            frame: { kind: "testId", value: "duplicate-frame", index: 0 },
            locator: { kind: "testId", value: "duplicate-result" },
          },
        });
      } catch (error) {
        throw new Error(`duplicate first frame result: ${String((error as Error)?.message ?? error)}`);
      }
      let duplicateSecondFrameText: unknown;
      try {
        duplicateSecondFrameText = await api.browserLocatorInnerText({
          browser: "chrome",
          tabId: tab.id,
          locator: {
            kind: "frame",
            frame: { kind: "testId", value: "duplicate-frame", index: 1 },
            locator: { kind: "testId", value: "duplicate-result" },
          },
        });
      } catch (error) {
        throw new Error(`duplicate second frame result: ${String((error as Error)?.message ?? error)}`);
      }
      await api.browserClick({
        browser: "chrome",
        tabId: tab.id,
        selector: "#alert",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const alertDialog = await api.browserDialog({
        browser: "chrome",
        tabId: tab.id,
      });
      if (!alertDialog) {
        const alertTriggered = await api.browserEvaluate({
          browser: "chrome",
          tabId: tab.id,
          expression: "globalThis.__backchatAlertTriggered === true",
        });
        throw new Error(`alert dialog missing; alertTriggered=${String(alertTriggered)}`);
      }
      await api.browserDismissDialog({ browser: "chrome", tabId: tab.id });
      await api.browserClick({
        browser: "chrome",
        tabId: tab.id,
        selector: "#confirm",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const confirmDialog = await api.browserDialog({
        browser: "chrome",
        tabId: tab.id,
      });
      if (!confirmDialog) {
        const confirmTriggered = await api.browserEvaluate({
          browser: "chrome",
          tabId: tab.id,
          expression: "globalThis.__backchatConfirmTriggered === true",
        });
        throw new Error(`confirm dialog missing; confirmTriggered=${String(confirmTriggered)}`);
      }
      await api.browserAcceptDialog({ browser: "chrome", tabId: tab.id });
      const confirmResult = await api.browserEvaluate({
        browser: "chrome",
        tabId: tab.id,
        expression: "document.querySelector('#dialog-result').textContent",
      });
      await api.browserClick({
        browser: "chrome",
        tabId: tab.id,
        selector: "#prompt",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const promptDialog = await api.browserDialog({
        browser: "chrome",
        tabId: tab.id,
      });
      if (!promptDialog) {
        const promptTriggered = await api.browserEvaluate({
          browser: "chrome",
          tabId: tab.id,
          expression: "globalThis.__backchatPromptTriggered === true",
        });
        throw new Error(`prompt dialog missing; promptTriggered=${String(promptTriggered)}`);
      }
      await api.browserAcceptDialog({
        browser: "chrome",
        tabId: tab.id,
        promptText: "typed prompt",
      });
      const promptResult = await api.browserEvaluate({
        browser: "chrome",
        tabId: tab.id,
        expression: "document.querySelector('#prompt-result').textContent",
      });
      await api.browserCloseTab({ browser: "chrome", tabId: tab.id });
      const tabsAfterClose = await api.browserTabs({ browser: "chrome" }) as Array<{ id: string }>;
      return {
        valueAfterClick,
        snapshot,
        screenshot,
        trustedLocatorResult,
        trustedDomCuaResult,
        frameButtonCount,
        frameResultText,
        duplicateFrameElementCount,
        duplicateSecondFrameSrc,
        duplicateFirstFrameText,
        duplicateSecondFrameText,
        alertDialog,
        confirmDialog,
        confirmResult,
        promptDialog,
        promptResult,
        tabStillOpen: tabsAfterClose.some((candidate) => candidate.id === tab.id),
      };
    }, url);

    assert.equal(result.valueAfterClick, "Ada:1");
    assert.match(String(result.snapshot), /Backchat Browser Fixture/);
    assert.equal(result.screenshot.mimeType, "image/jpeg");
    assert.ok(result.screenshot.base64.length > 100);
    assert.equal(result.trustedLocatorResult, "trusted");
    assert.equal(result.trustedDomCuaResult, "trusted");
    assert.equal(result.frameButtonCount, 1);
    assert.equal(result.frameResultText, "remote:1");
    assert.equal(result.duplicateFrameElementCount, 2);
    assert.match(String(result.duplicateSecondFrameSrc), /\/duplicate-frame$/);
    assert.equal(result.duplicateFirstFrameText, "duplicate:0");
    assert.equal(result.duplicateSecondFrameText, "duplicate:1");
    assert.deepEqual(result.alertDialog, { type: "alert", message: "Backchat alert" });
    assert.deepEqual(result.confirmDialog, { type: "confirm", message: "Backchat confirm" });
    assert.equal(result.confirmResult, "accepted");
    assert.deepEqual(result.promptDialog, {
      type: "prompt",
      message: "Backchat prompt",
      defaultValue: "default prompt",
    });
    assert.equal(result.promptResult, "typed prompt");
    assert.equal(result.tabStillOpen, false);
  } finally {
    await chrome.cleanup();
    await cleanup();
    await server.close();
    await frameServer.close();
  }
}

async function launchChromiumWithBackchatExtension(bridgePort: number): Promise<{
  context: BrowserContext;
  extensionId: string;
  cleanup: () => Promise<void>;
}> {
  const userDataDir = await mkdtemp(join(tmpdir(), "backchat-chrome-extension-e2e-"));
  const e2eExtensionDir = await copyExtensionWithBridgePort(bridgePort);
  const executablePath = resolveChromiumExecutablePath();
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : { channel: "chromium" as const }),
    headless: false,
    args: [
      "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
      `--disable-extensions-except=${e2eExtensionDir}`,
      `--load-extension=${e2eExtensionDir}`,
    ],
  });
  const keepDialogsForBackchat = (page: Page) => {
    page.on("dialog", () => {
      // Backchat should inspect and handle native dialogs through its
      // extension bridge; Playwright's default auto-dismiss would mask that.
    });
  };
  for (const page of context.pages()) keepDialogsForBackchat(page);
  context.on("page", keepDialogsForBackchat);
  const serviceWorker = context.serviceWorkers()[0] ??
    await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const extensionId = serviceWorker.url().split("/")[2] ?? "";
  return {
    context,
    extensionId,
    cleanup: async () => {
      await context.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true });
      await rm(e2eExtensionDir, { recursive: true, force: true });
    },
  };
}

async function copyExtensionWithBridgePort(bridgePort: number): Promise<string> {
  const destination = await mkdtemp(join(tmpdir(), "backchat-browser-extension-e2e-"));
  await cp(extensionDir, destination, { recursive: true });
  const backgroundPath = join(destination, "background.js");
  const background = await readFile(backgroundPath, "utf8");
  await writeFile(
    backgroundPath,
    background.replace(
      /const DEFAULT_BRIDGE_PORT = \d+;/,
      `const DEFAULT_BRIDGE_PORT = ${bridgePort};`,
    ),
  );
  return destination;
}

async function resolveChromeBridgePort(page: Awaited<ReturnType<typeof launchApp>>["page"]): Promise<number> {
  let latestPort = 0;
  await expect.poll(async () => {
    const bridgePort = await page.evaluate(async () => {
      const api = (window as unknown as {
        backchat: {
          browserList(): Promise<Array<{ type: string; metadata?: Record<string, string> }>>;
        };
      }).backchat;
      const chrome = (await api.browserList())
        .find((browser) => browser.type === "extension");
      return chrome?.metadata?.bridgePort ?? "0";
    });
    latestPort = Number(bridgePort);
    return latestPort;
  }, {
    intervals: [100],
    timeout: 10_000,
  }).not.toBe(0);
  return latestPort;
}

function resolveChromiumExecutablePath(): string | null {
  const candidates = [
    "/Users/xiaoyang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
    "/Users/xiaoyang/Library/Caches/ms-playwright/chromium-1223/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "/Users/xiaoyang/Library/Caches/ms-playwright/chromium-1181/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "/Users/xiaoyang/Library/Caches/ms-playwright/chromium-1169/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "/Users/xiaoyang/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "/Users/xiaoyang/Library/Application Support/pyppeteer/local-chromium/1181205/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function chromeBridgeConnected(page: Awaited<ReturnType<typeof launchApp>>["page"]): Promise<boolean> {
  return page.evaluate(async () => {
    const api = (window as unknown as {
      backchat: {
        browserList(): Promise<Array<{ type: string; metadata?: Record<string, string> }>>;
      };
    }).backchat;
    const browsers = await api.browserList();
    return browsers.some((browser) =>
      browser.type === "extension" && Boolean(browser.metadata?.extensionId)
    );
  });
}

async function startFixtureServer(framePort: number): Promise<{ port: number; close: () => Promise<void> }> {
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
        </head>
        <body>
          <main>
            <h1>Backchat Browser Fixture</h1>
            <label>Name <input id="name" aria-label="Name" /></label>
            <button id="ping">Ping</button>
            <output id="result">idle</output>
            <button data-testid="trusted-locator">Trusted locator</button>
            <output id="trusted-result">none</output>
            <button>Trusted DOM CUA</button>
            <output id="dom-cua-result">none</output>
            <button id="alert">Alert</button>
            <button id="confirm">Confirm</button>
            <output id="dialog-result">none</output>
            <button id="prompt">Prompt</button>
            <output id="prompt-result">none</output>
            <iframe
              data-testid="remote-frame"
              src="http://127.0.0.1:${framePort}/remote-frame"
              title="Remote frame"
            ></iframe>
            <iframe
              data-testid="duplicate-frame"
              src="http://127.0.0.1:${framePort}/duplicate-frame"
              title="Duplicate frame one"
            ></iframe>
            <iframe
              data-testid="duplicate-frame"
              src="http://127.0.0.1:${framePort}/duplicate-frame"
              title="Duplicate frame two"
            ></iframe>
          </main>
          <script>
            let count = 0;
            document.querySelector("#ping").addEventListener("click", () => {
              count += 1;
              document.querySelector("#result").textContent =
                document.querySelector("#name").value + ":" + count;
            });
            document.querySelector("#alert").addEventListener("click", () => {
              globalThis.__backchatAlertTriggered = true;
              alert("Backchat alert");
            });
            document.querySelector("[data-testid=trusted-locator]").addEventListener("click", (event) => {
              document.querySelector("#trusted-result").textContent =
                event.isTrusted ? "trusted" : "synthetic";
            });
            document.querySelector("#dom-cua-result").previousElementSibling.addEventListener("click", (event) => {
              document.querySelector("#dom-cua-result").textContent =
                event.isTrusted ? "trusted" : "synthetic";
            });
            document.querySelector("#confirm").addEventListener("click", () => {
              globalThis.__backchatConfirmTriggered = true;
              document.querySelector("#dialog-result").textContent =
                confirm("Backchat confirm") ? "accepted" : "dismissed";
            });
            document.querySelector("#prompt").addEventListener("click", () => {
              globalThis.__backchatPromptTriggered = true;
              document.querySelector("#prompt-result").textContent =
                prompt("Backchat prompt", "default prompt") || "";
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

async function startFrameFixtureServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/duplicate-frame") {
      res.end(`<!doctype html>
        <html>
          <head>
            <title>Backchat Duplicate Remote Frame</title>
          </head>
          <body>
            <button data-testid="duplicate-ping">Duplicate ping</button>
            <output data-testid="duplicate-result">duplicate:0</output>
            <script>
              let count = 0;
              document.querySelector("[data-testid=duplicate-ping]").addEventListener("click", () => {
                count += 1;
                document.querySelector("[data-testid=duplicate-result]").textContent = "duplicate:" + count;
              });
            </script>
          </body>
        </html>`);
      return;
    }
    res.end(`<!doctype html>
      <html>
        <head>
          <title>Backchat Remote Frame</title>
        </head>
        <body>
          <button data-testid="remote-ping">Remote ping</button>
          <output data-testid="remote-result">remote:0</output>
          <script>
            let count = 0;
            document.querySelector("[data-testid=remote-ping]").addEventListener("click", () => {
              count += 1;
              document.querySelector("[data-testid=remote-result]").textContent = "remote:" + count;
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
