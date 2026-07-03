import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { launchApp } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const extensionDir = join(repoRoot, "packages/browser-extension");
const evidenceDir = resolve(repoRoot, "artifacts/browser-plugin-gui-evidence");
const execFileAsync = promisify(execFile);

type EvidenceResult = Record<string, unknown> & {
  url: string;
  toolCallSummary: Record<string, unknown>;
};

async function main(): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });

  const target = process.env["BACKCHAT_BROWSER_EVIDENCE_TARGET"] ?? "all";
  const iab = target === "chrome" ? null : await captureInAppBrowserEvidence();
  const chrome = target === "iab" ? null : await captureChromeExtensionEvidence();

  const manifest = {
    generatedAt: new Date().toISOString(),
    evidenceDir,
    claims: [
      ...(iab ? [{
        claim: "Backchat in-app Browser is visible as an owned desktop GUI window.",
        evidence: presentPaths([
          iab.desktopScreenshotPath,
          iab.desktopWindowCropPath,
          iab.rendererScreenshotPath,
          iab.tabScreenshotPath,
        ]),
        toolCallSummary: iab.toolCallSummary,
        assertions: {
          backendUrl: iab.url,
          backendScreenshot: iab.tabScreenshotPath,
          pageState: "Name field contains Ada; Ping result is Ada:1.",
        },
      }] : []),
      ...(chrome ? [{
        claim: "Backchat Chrome extension backend controls a real Chromium tab.",
        evidence: presentPaths([
          chrome.desktopScreenshotPath,
          chrome.chromePagePath,
          chrome.chromeTabScreenshotPath,
        ]),
        toolCallSummary: chrome.toolCallSummary,
        assertions: {
          backendUrl: chrome.url,
          extensionId: chrome.extensionId,
          tabId: chrome.tabId,
          pageState: "Name field contains Ada; Ping result is Ada:1; trusted locator result is trusted.",
        },
      }] : []),
      ...(chrome ? [{
        claim: "The Backchat app saw the Chrome extension bridge as connected.",
        evidence: presentPaths([chrome.appWindowPath]),
        assertions: {
          extensionId: chrome.extensionId,
        },
      }] : []),
    ],
  };
  const manifestPath = join(evidenceDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
}

function presentPaths(paths: unknown[]): string[] {
  return paths.filter((path): path is string => typeof path === "string" && path.length > 0);
}

async function captureInAppBrowserEvidence(): Promise<EvidenceResult> {
  const server = await startFixtureServer();
  const appRun = await launchApp({ env: { BACKCHAT_E2E_VISIBLE: "1" } });
  const url = `http://127.0.0.1:${server.port}/fixture`;
  try {
    await showWindow(appRun.app);
    const mainWindowId = await currentMainWindowId(appRun.app);
    const result = await appRun.page.evaluate(async (fixtureUrl) => {
      const api = (window as unknown as {
        backchat: Record<string, (...args: unknown[]) => Promise<unknown>>;
      }).backchat;
      const browsers = await api.browserList();
      const tab = await api.browserNewTab({ browser: "iab" }) as { id: string };
      await api.browserNameSession({ browser: "iab", name: "GUI evidence IAB" });
      await api.browserSetViewport({ browser: "iab", width: 960, height: 640 });
      await api.browserGoto({ browser: "iab", tabId: tab.id, url: fixtureUrl });
      await api.browserWaitForURL({
        browser: "iab",
        tabId: tab.id,
        url: fixtureUrl,
        waitUntil: "domcontentloaded",
        timeoutMs: 10_000,
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
      await api.browserSetVisibility({ browser: "iab", visible: true });
      const resultText = await api.browserEvaluate({
        browser: "iab",
        tabId: tab.id,
        expression: "document.querySelector('#result').textContent",
      });
      const currentUrl = await api.browserUrl({ browser: "iab", tabId: tab.id });
      const title = await api.browserTitle({ browser: "iab", tabId: tab.id });
      const domSnapshot = await api.browserDomSnapshot({ browser: "iab", tabId: tab.id });
      const screenshot = await api.browserScreenshot({ browser: "iab", tabId: tab.id }) as {
        base64: string;
        mimeType: string;
      };
      return {
        browsers,
        tabId: tab.id,
        currentUrl,
        title,
        resultText,
        domSnapshot,
        screenshot,
      };
    }, url);
    if (
      result.currentUrl !== url ||
      result.title !== "Backchat Browser Fixture" ||
      result.resultText !== "Ada:1" ||
      !String(result.domSnapshot).includes("Backchat Browser Fixture")
    ) {
      throw new Error(`unexpected IAB evidence state: ${JSON.stringify(result)}`);
    }

    await appRun.page.waitForTimeout(1_000);

    const appScreenshotPath = join(evidenceDir, "backchat-iab-main-window-electron-capture.png");
    const rendererScreenshotPath = join(evidenceDir, "backchat-iab-main-window-renderer.png");
    const desktopScreenshotPath = join(evidenceDir, "backchat-iab-owned-window-desktop.png");
    const desktopWindowCropPath = join(evidenceDir, "backchat-iab-owned-window-crop.png");
    const tabScreenshotPath = join(evidenceDir, "iab-tab-screenshot.jpg");
    await writeNativeWindowScreenshotIfAvailable(appRun.app, appScreenshotPath);
    await writeDesktopScreenshot(desktopScreenshotPath);
    await writeAuxiliaryWindowScreenshot(appRun.app, mainWindowId, desktopWindowCropPath);
    const rendererScreenshotSaved = await writeRendererScreenshotIfAvailable(
      appRun.page,
      rendererScreenshotPath,
    );
    await writeFile(tabScreenshotPath, Buffer.from(result.screenshot.base64, "base64"));
    return {
      appScreenshotPath,
      ...(rendererScreenshotSaved ? { rendererScreenshotPath } : {}),
      desktopScreenshotPath,
      desktopWindowCropPath,
      tabScreenshotPath,
      url,
      toolCallSummary: {
        browsers: result.browsers,
        tabId: result.tabId,
        currentUrl: result.currentUrl,
        title: result.title,
        resultText: result.resultText,
        domSnapshotContainsFixture: String(result.domSnapshot).includes("Backchat Browser Fixture"),
        screenshotMimeType: result.screenshot.mimeType,
        screenshotBase64Length: result.screenshot.base64.length,
      },
    };
  } finally {
    await appRun.cleanup();
    await server.close();
  }
}

async function captureChromeExtensionEvidence(): Promise<EvidenceResult> {
  const server = await startFixtureServer();
  const appRun = await launchApp({
    env: {
      BACKCHAT_E2E_VISIBLE: "1",
      BACKCHAT_BROWSER_EXTENSION_PORT: "0",
    },
  });
  let chrome: Awaited<ReturnType<typeof launchChromiumWithBackchatExtension>> | null = null;
  const url = `http://127.0.0.1:${server.port}/fixture`;
  try {
    await showWindow(appRun.app);
    const bridgePort = await resolveChromeBridgePort(appRun.page);
    chrome = await launchChromiumWithBackchatExtension(bridgePort);
    await expect.poll(() => chromeBridgeConnected(appRun.page), {
      intervals: [1_000],
      timeout: 45_000,
    }).toBe(true);

    const result = await appRun.page.evaluate(async (fixtureUrl) => {
      const api = (window as unknown as {
        backchat: Record<string, (...args: unknown[]) => Promise<unknown>>;
      }).backchat;
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
      await api.browserLocatorClick({
        browser: "chrome",
        tabId: tab.id,
        locator: { kind: "testId", value: "trusted-locator" },
      });
      const browsers = await api.browserList();
      const currentUrl = await api.browserUrl({ browser: "chrome", tabId: tab.id });
      const title = await api.browserTitle({ browser: "chrome", tabId: tab.id });
      return {
        browsers,
        tabId: tab.id,
        currentUrl,
        title,
        valueAfterClick: await api.browserEvaluate({
          browser: "chrome",
          tabId: tab.id,
          expression: "document.querySelector('#result').textContent",
        }),
        trustedLocatorResult: await api.browserEvaluate({
          browser: "chrome",
          tabId: tab.id,
          expression: "document.querySelector('#trusted-result').textContent",
        }),
        screenshot: await api.browserScreenshot({ browser: "chrome", tabId: tab.id }) as {
          base64: string;
          mimeType: string;
        },
      };
    }, url);

    if (result.valueAfterClick !== "Ada:1" || result.trustedLocatorResult !== "trusted") {
      throw new Error(`unexpected Chrome evidence state: ${JSON.stringify(result)}`);
    }

    const chromePage = await findChromePage(chrome.context, url);
    await chromePage.bringToFront();
    await chromePage.waitForTimeout(500);
    const desktopScreenshotPath = join(evidenceDir, "chrome-extension-desktop.png");
    const chromePagePath = join(evidenceDir, "chrome-extension-page.png");
    const chromeTabScreenshotPath = join(evidenceDir, "chrome-tab-screenshot.jpg");
    const appWindowPath = join(evidenceDir, "backchat-chrome-extension-connected.png");
    await writeDesktopScreenshot(desktopScreenshotPath);
    await chromePage.screenshot({ path: chromePagePath, fullPage: true });
    await writeFile(chromeTabScreenshotPath, Buffer.from(result.screenshot.base64, "base64"));
    await writeNativeWindowScreenshotIfAvailable(appRun.app, appWindowPath);
    return {
      appWindowPath,
      desktopScreenshotPath,
      chromePagePath,
      chromeTabScreenshotPath,
      url,
      extensionId: chrome.extensionId,
      tabId: result.tabId,
      toolCallSummary: {
        browsers: result.browsers,
        tabId: result.tabId,
        currentUrl: result.currentUrl,
        title: result.title,
        valueAfterClick: result.valueAfterClick,
        trustedLocatorResult: result.trustedLocatorResult,
        screenshotMimeType: result.screenshot.mimeType,
        screenshotBase64Length: result.screenshot.base64.length,
      },
    };
  } finally {
    await chrome?.cleanup();
    await appRun.cleanup();
    await server.close();
  }
}

async function showWindow(app: Awaited<ReturnType<typeof launchApp>>["app"]): Promise<void> {
  await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible()) ??
      BrowserWindow.getAllWindows()[0];
    const workArea = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1440, Math.max(960, workArea.width - 80));
    const height = Math.min(960, Math.max(720, workArea.height - 80));
    win.setBounds({
      x: workArea.x + Math.max(20, Math.floor((workArea.width - width) / 2)),
      y: workArea.y + Math.max(20, Math.floor((workArea.height - height) / 2)),
      width,
      height,
    });
    win.show();
    win.focus();
  });
}

async function currentMainWindowId(
  app: Awaited<ReturnType<typeof launchApp>>["app"],
): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible()) ??
      BrowserWindow.getAllWindows()[0];
    return win.id;
  });
}

async function writeNativeWindowScreenshotIfAvailable(
  app: Awaited<ReturnType<typeof launchApp>>["app"],
  path: string,
): Promise<void> {
  const dataUrl = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible()) ??
      BrowserWindow.getAllWindows()[0];
    const image = await win.webContents.capturePage();
    return image.toDataURL();
  });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  if (base64.length !== 0) {
    await writeFile(path, Buffer.from(base64, "base64"));
  }
}

async function writeRendererScreenshotIfAvailable(page: Page, path: string): Promise<boolean> {
  try {
    await page.screenshot({ path, fullPage: false, timeout: 5_000 });
    await assertNonEmptyFile(path);
    return true;
  } catch {
    return false;
  }
}

async function writeDesktopScreenshot(path: string): Promise<void> {
  await execFileAsync("screencapture", ["-x", path]);
  await assertNonEmptyFile(path);
}

async function writeAuxiliaryWindowScreenshot(
  app: Awaited<ReturnType<typeof launchApp>>["app"],
  mainWindowId: number,
  path: string,
): Promise<void> {
  const target = await app.evaluate(({ BrowserWindow, screen }, excludedWindowId) => {
    const win = BrowserWindow.getAllWindows()
      .filter((candidate) => candidate.id !== excludedWindowId)
      .find((candidate) => {
        const bounds = candidate.getBounds();
        return candidate.isVisible() && bounds.x > -10_000 && bounds.y > -10_000;
      });
    if (!win) {
      throw new Error("Could not find a visible auxiliary browser window");
    }
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const mediaSourceId = typeof win.getMediaSourceId === "function"
      ? win.getMediaSourceId()
      : "";
    return {
      windowId: /^window:(\d+):/.exec(mediaSourceId)?.[1] ?? "",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      scaleFactor: display.scaleFactor,
    };
  }, mainWindowId);
  if (target.windowId) {
    await execFileAsync("screencapture", ["-x", "-l", target.windowId, path]);
    await assertNonEmptyFile(path);
    return;
  }
  const scale = target.scaleFactor || 1;
  const region = [
    Math.round(target.x * scale),
    Math.round(target.y * scale),
    Math.round(target.width * scale),
    Math.round(target.height * scale),
  ].join(",");
  await execFileAsync("screencapture", ["-x", "-R", region, path]);
  await assertNonEmptyFile(path);
}

async function assertNonEmptyFile(path: string): Promise<void> {
  const stats = await stat(path);
  if (stats.size === 0) {
    throw new Error(`empty screenshot: ${path}`);
  }
}

async function launchChromiumWithBackchatExtension(bridgePort: number): Promise<{
  context: BrowserContext;
  extensionId: string;
  cleanup: () => Promise<void>;
}> {
  const userDataDir = await mkdtemp(join(tmpdir(), "backchat-chrome-extension-evidence-"));
  const e2eExtensionDir = await copyExtensionWithBridgePort(bridgePort);
  const executablePath = resolveChromiumExecutablePath();
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : { channel: "chromium" as const }),
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
      `--disable-extensions-except=${e2eExtensionDir}`,
      `--load-extension=${e2eExtensionDir}`,
    ],
  });
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
  const destination = await mkdtemp(join(tmpdir(), "backchat-browser-extension-evidence-"));
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

async function resolveChromeBridgePort(page: Page): Promise<number> {
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

async function chromeBridgeConnected(page: Page): Promise<boolean> {
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

async function findChromePage(context: BrowserContext, url: string): Promise<Page> {
  for (const page of context.pages()) {
    if (page.url() === url) return page;
  }
  return context.waitForEvent("page", {
    predicate: (page) => page.url() === url,
    timeout: 10_000,
  });
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
            body {
              margin: 0;
              padding: 32px;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              background: #f7faf7;
              color: #14221c;
            }
            main { max-width: 760px; }
            h1 { margin: 0 0 18px; font-size: 34px; }
            label, button, output {
              display: block;
              font: inherit;
              margin: 12px 0;
            }
            input {
              margin-left: 8px;
              padding: 8px 10px;
              border: 1px solid #8ca596;
              border-radius: 6px;
            }
            button {
              padding: 10px 14px;
              border: 1px solid #2b6a4b;
              border-radius: 6px;
              background: #2f7d55;
              color: white;
            }
            output {
              padding: 10px 12px;
              border: 1px solid #b7c9bd;
              border-radius: 6px;
              background: white;
              min-height: 24px;
            }
            .badge {
              display: inline-block;
              margin-bottom: 14px;
              padding: 5px 8px;
              border-radius: 999px;
              background: #dceee4;
              color: #24573d;
              font-size: 13px;
            }
          </style>
        </head>
        <body>
          <main>
            <div class="badge">Backchat Browser GUI Evidence</div>
            <h1>Backchat Browser Fixture</h1>
            <label>Name <input id="name" aria-label="Name" /></label>
            <button id="ping">Ping</button>
            <output id="result">idle</output>
            <button data-testid="trusted-locator">Trusted locator</button>
            <output id="trusted-result">none</output>
          </main>
          <script>
            let count = 0;
            document.querySelector("#ping").addEventListener("click", () => {
              count += 1;
              document.querySelector("#result").textContent =
                document.querySelector("#name").value + ":" + count;
            });
            document.querySelector("[data-testid=trusted-locator]").addEventListener("click", (event) => {
              document.querySelector("#trusted-result").textContent =
                event.isTrusted ? "trusted" : "synthetic";
            });
          </script>
        </body>
      </html>`);
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    }),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
