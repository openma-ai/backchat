import { app, BrowserWindow, dialog, nativeImage, net, protocol, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { registerIpc } from "./ipc.js";
import { setSessionRoot } from "./session-cwd.js";
import { settingsStore } from "./settings-store.js";
import { openSessionDb } from "./sql-store.js";
import { installAppMenu, sendToFocused } from "./menu.js";
import { disposeAllUiTerminals } from "./ui-terminal-broker.js";

// Dev-only: enable CDP on port 9222 so agent-browser can drive the
// renderer for end-to-end UI tests. No-op in production. Also skip
// when Playwright is the one driving — it opens its own CDP port and
// our hard-coded 9222 collides with another running dev electron.
if (
  process.env["NODE_ENV"] !== "production" &&
  process.env["BACKCHAT_TEST_HOOKS"] !== "1"
) {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
  // Allow our diagnostic scripts (and the agent-browser e2e harness) to
  // open a CDP WebSocket without the dev-tools Origin check rejecting
  // them. Dev-only — never set in production.
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

const windows = new Set<BrowserWindow>();

/**
 * Re-position the macOS trafficLight to track current zoom AND match the
 * sidebar collapse toggle's center exactly.
 *
 * Constants (single source of truth — keep these in sync with the
 * renderer's GlobalSidebarToggle in AppShell.tsx):
 */
/**
 * VSCode-standard formula. trafficLight visual height is 16pt (12pt dot
 * + 2pt margin top + 2pt margin bottom). setWindowButtonPosition.y is
 * the TOP of that 16pt visual band. To center the band at y = centerY,
 * position.y = floor(centerY - 8). VSCode uses floor (not round/ceil)
 * because Electron's internal rounding biases the dots upward.
 *
 * Reference: microsoft/vscode#212471 "Fix traffic light centering on
 * macOS" — same calculation used by VSCode's window chrome.
 */
// Mirrors the CSS values in src/renderer/src/styles/index.css:
//   --chrome-top:  12px
//   --chrome-size: 28px   (the .size-6 override)
// The main process can't import a CSS var, so we duplicate the
// numbers here and rely on syncTrafficLight to keep the macOS
// trafficLight dot center on the same y as the toggle center.
// If you change the CSS, change these too — mismatch shows up
// as a 1-2 px vertical offset between the trafficLight and the
// sidebar's `□` collapse button.
const TOGGLE_TOP_PX = 12;        // CSS `top` on toggle (var(--chrome-top))
const TOGGLE_SIZE_PX = 28;       // size-6 = 28px (after the .size-6 override)
const TRAFFIC_LIGHT_DOT_PX = 12; // macOS standard window button diameter

// Privileged custom protocol for serving local filesystem assets to the
// renderer. The dev renderer runs on `http://localhost:5173` and the
// production renderer on `file://...index.html`; in both cases the
// browser refuses to load `<img src="file:///Users/...">` from a
// different origin (SecurityError / mixed content). Registering
// `oma-file://` as `standard + secure + supportFetchAPI` lets `<img>`
// and `fetch()` load it the same way they would `https://`, with a
// main-process protocol handler streaming bytes from the on-disk file.
//
// Path scoping (enforced in the handler) keeps the renderer from
// reading arbitrary user files: only `~/.openma/` and
// `~/.codex/generated_images/` resolve. Anything else returns 404.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "oma-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

/** Empirical offset: setWindowButtonPosition.y is bbox top, dot center
 *  sits at position.y + this value. Calibrated by single-variable
 *  adjustment: increase to push trafficLight UP, decrease to push DOWN. */
const TRAFFIC_LIGHT_CENTER_FROM_TOP = 7;

export function syncTrafficLight(win: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  if (win.isDestroyed()) return;
  const z = win.webContents.getZoomFactor();

  // Toggle center y in chrome coords (renderer px × zoom).
  const toggleCenterY = (TOGGLE_TOP_PX + TOGGLE_SIZE_PX / 2) * z;

  // position.y is bbox top; dot center = position.y + TRAFFIC_LIGHT_CENTER_FROM_TOP.
  // Solve: position.y = toggleCenterY - TRAFFIC_LIGHT_CENTER_FROM_TOP.
  const positionY = Math.floor(toggleCenterY - TRAFFIC_LIGHT_CENTER_FROM_TOP);

  const ANCHOR_X = 30;
  const positionX = Math.floor(ANCHOR_X * z - TRAFFIC_LIGHT_DOT_PX / 2);

  win.setWindowButtonPosition({ x: positionX, y: positionY });

  win.webContents
    .executeJavaScript(
      `document.documentElement.style.setProperty('--zoom', '${z}')`,
      true,
    )
    .catch(() => {});
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#0b0b0c",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // macOS only: trafficLight at (24, 18) — center y = 25, center x = 31.
    // Matches the sidebar's icon-column center: stage_inset(6) +
    // sidebar_internal_paddingLeft(8) + button_paddingLeft(8) + size-4
    // slot center(8) = 30. Off-by-one px, indistinguishable visually.
    // Toggle button shares the same y in renderer code.
    trafficLightPosition:
      process.platform === "darwin" ? { x: 24, y: 18 } : undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // <webview> tag for the side-panel browser tabs. Without this,
      // <webview> elements silently render as empty divs. The tag
      // itself is opt-in per Electron security model — we own all
      // markup so injection is not a concern; the browser tab simply
      // lets users open arbitrary URLs in an isolated sub-context.
      webviewTag: true,
    },
  });
  windows.add(win);
  win.on("closed", () => windows.delete(win));

  // Initial trafficLight sync + on focus (covers reload). zoom-changed
  // event only fires on ctrl+wheel — the menu's Zoom In/Out items call
  // syncTrafficLight explicitly (see menu.ts).
  win.webContents.on("did-finish-load", () => syncTrafficLight(win));
  win.on("focus", () => syncTrafficLight(win));

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Block in-window navigation. Anything that isn't the dev-server URL
  // or our packaged file:// renderer is treated as an external link —
  // hand it to the OS shell and prevent the navigation. Without this,
  // a stray `<a href="foo.html">` (e.g. agent-emitted markdown link)
  // would blow away the React app and load that URL relative to the
  // current renderer origin (image #93: clicking `index.html` landed
  // on http://localhost:5174/index.html in dev). Internal HMR reloads
  // and in-app routing use replaceState / pushState, neither of which
  // fires will-navigate, so we don't need a same-origin allowlist.
  //
  // file:// hrefs are a special case: the renderer's own MarkdownAnchor
  // routes those into the sidebar BrowserTab via openSideTab, so we
  // should NEVER pop them in the OS shell. If somehow a file:// click
  // slips past the React handler (e.g. middle-click, drag-and-drop),
  // we still cancel the navigation but quietly swallow it — better
  // than spawning a Chrome window for a file the user can already
  // see in the sidebar.
  win.webContents.on("will-navigate", (event, url) => {
    const here = win.webContents.getURL();
    try {
      const here_o = new URL(here).origin;
      const there_o = new URL(url).origin;
      if (here_o === there_o) return; // same-origin reload — allow
    } catch {
      /* malformed — fall through, treat as external */
    }
    event.preventDefault();
    if (url.startsWith("file://")) {
      // Already handled (or intentionally swallowed) by the renderer.
      console.log("[will-navigate] swallowed file://", url);
      return;
    }
    void shell.openExternal(url);
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

// Only one Electron process; secondary launches surface as a new window
// in the existing instance via second-instance event. Bypass when
// Playwright drives the launch (BACKCHAT_TEST_HOOKS) — each spec spawns
// its own electron process; if dev mode is already running, the lock
// makes the test instance silently quit before firstWindow resolves.
const gotLock =
  process.env["BACKCHAT_TEST_HOOKS"] === "1"
    ? true
    : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => createWindow());

  app.whenReady().then(async () => {
    // Wire the oma-file:// handler. Whitelist enforced here so a
    // compromised renderer can't read arbitrary user files via
    // `fetch("oma-file:///etc/passwd")`. Paths must live under one of
    // the allow-list roots — anything else returns 404. The renderer
    // composes the URL as `oma-file://abs-path` (we strip the
    // leading `/` and re-add it inside the handler).
    const allowRoots = [
      join(homedir(), ".openma"),
      join(homedir(), ".codex", "generated_images"),
    ];
    protocol.handle("oma-file", async (request) => {
      try {
        // URL shape: `oma-file://local/<abs-posix-path>`. "local" is a
        // synthetic, ignored host token — without it Electron's URL
        // parser eats the first path segment as the hostname (e.g.
        // `oma-file:///Users/x.png` → hostname="Users", pathname="/x.png"
        // and our pathname-only allow-list check silently rejects it).
        // Renderer must always include the "local" host (see
        // ToolContentRenderer in ChatView.tsx).
        const url = new URL(request.url);
        // URL also percent-encodes segments (spaces, CJK, etc.) —
        // decodeURIComponent fixes those back to raw filesystem bytes.
        const decoded = decodeURIComponent(url.pathname);
        const abs = decoded.startsWith("/") ? decoded : "/" + decoded;
        const allowed = allowRoots.some((r) => abs.startsWith(r + "/") || abs === r);
        if (!allowed) {
          return new Response("forbidden", { status: 403 });
        }
        return net.fetch("file://" + abs);
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    });

    // Dev mode dock icon. In production the .icns embedded by
    // electron-builder is what the OS reads; here in `pnpm dev` we're
    // running the stock Electron binary whose Info.plist points at its
    // own atom-purple logo, so the user sees that instead of ours.
    // Setting app.dock.setIcon() at startup swaps it for build/icon.png.
    // No-op outside macOS (linux/win don't expose `app.dock`).
    if (
      process.platform === "darwin" &&
      !app.isPackaged &&
      typeof app.dock?.setIcon === "function"
    ) {
      try {
        const img = nativeImage.createFromPath(
          join(process.cwd(), "build", "icon.png"),
        );
        if (!img.isEmpty()) app.dock.setIcon(img);
      } catch {
        /* dock icon is cosmetic; don't fail launch over it */
      }
    }

    try {
      await settingsStore.load();
    } catch (e) {
      dialog.showErrorBox(
        "Settings file error",
        `${(e as Error).message}\n\nBackchat will start with default settings.`,
      );
    }

    // Shared dotdir with the future openma cli. Keeping sessions.db /
    // sessions/ / registry-cache.json under ~/.openma/ lets the cli
    // (when it lands) read the same conversation history rather than
    // sitting on a Backchat-private userData island. mkdir is implicit
    // via SettingsStore.ensureDir() on first write; the SQL store /
    // session cwd helpers create their own subpaths on demand.
    const root = join(homedir(), ".openma");
    setSessionRoot(join(root, "sessions"));
    openSessionDb(join(root, "sessions.db"));
    registerIpc({ registryCachePath: join(root, "registry-cache.json") });

    installAppMenu({
      openNewWindow: () => createWindow(),
      focusedWebContentsSend: sendToFocused,
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Kill any live pty children before electron tears down. Without this,
// orphaned shells linger as zombie processes (visible in `ps aux` until
// reboot on macOS / until next user logout on Linux).
app.on("before-quit", () => {
  disposeAllUiTerminals();
});
