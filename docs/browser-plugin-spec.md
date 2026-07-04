# Backchat Browser Plugin Spec

Status: implemented baseline with documented parity caveats, verified on
2026-07-03.

This document records the product boundary, API contract, observed runtime
behavior, and implementation plan for reproducing Codex Browser plugin behavior
inside Backchat. It covers both the in-app browser backend and the Chrome
extension backend.

## Source Of Truth

- Browser plugin runtime documentation, read from the active Browser plugin via
  `browser.documentation()`.
- Black-box probes against the active Browser plugin using a local
  `http://127.0.0.1` page.
- ACP v1 official docs:
  - https://agentclientprotocol.com/protocol/v1/overview
  - https://agentclientprotocol.com/protocol/v1/initialization
  - https://agentclientprotocol.com/protocol/v1/session-setup
  - https://agentclientprotocol.com/protocol/v1/tool-calls
  - https://agentclientprotocol.com/protocol/v1/extensibility
  - https://agentclientprotocol.com/protocol/v1/session-config-options
- Chrome extension permissions documentation:
  - https://developer.chrome.com/docs/extensions/reference/api/permissions
- Chrome extension scripting documentation:
  - https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome extension webNavigation documentation:
  - https://developer.chrome.com/docs/extensions/reference/api/webNavigation
- Chrome extension debugger documentation:
  - https://developer.chrome.com/docs/extensions/reference/api/debugger

Important ACP constraint: browser automation is not a built-in ACP v1 client
capability. ACP standard client capabilities are currently filesystem and
terminal oriented. Agents receive external tools through `session/new`
`mcpServers`; custom protocol extensions must use `_meta` or method names
starting with `_`. Therefore Backchat should expose Browser behavior to ACP
agents through an MCP server or a clearly namespaced ACP extension, not by
inventing root-level ACP fields. Session-level selectors such as model/mode
must continue to use `configOptions` and `session/set_config_option` where
applicable; Browser tools are not session config options.

## Browser Runtime Model

The Browser plugin exposes a JavaScript API rooted at `agent.browsers`.

Primary types:

- `agent.browsers.list()`: lists available browser backends.
- `agent.browsers.get(idOrType)`: selects a browser by id or type.
- `Browser`:
  - `browserId`
  - `capabilities`
  - `tabs`
  - `user`
  - `documentation()`
  - `nameSession(name)`: records a human-readable automation-session label.

Backchat agents do not execute inside the Browser plugin JavaScript runtime, so
the runtime `documentation()` helper is exposed as the MCP tool
`browser.documentation`.

- `BrowserUser`:
  - `openTabs()`: read-only list of top-level user tabs.
- `Tabs`:
  - `list()`
  - `new()`
  - `get(id)`
  - `selected()`
- `Tab`:
  - identity: `id`
  - navigation: `goto(url)`, `reload()`, `back()`, `forward()`, `close()`
  - state: `url()`, `title()`
  - visual: `screenshot({ clip?, fullPage? })`
  - dialogs: `getJsDialog()`
  - interaction APIs: `playwright`, `cua`, `dom_cua`
  - clipboard: `read()`, `readText()`, `write(items)`, `writeText(text)`
  - developer: `dev.logs({ filter?, levels?, limit? })`
  - capabilities: tab-scoped capability collection

Supported Browser capabilities:

- `visibility` on Codex IAB only:
  - `get(): Promise<boolean>`
  - `set(visible: boolean): Promise<void>`
- `viewport` on Codex IAB only:
  - `set({ width, height }): Promise<void>`
  - `reset(): Promise<void>`

Supported Tab capability:

- `pageAssets` on both IAB and Chrome extension:
  - `list()`: returns inventory `{ id, pageUrl, assets, inlineSvgs, summary }`
  - `bundle({ inventoryId, kinds?, assetIds? })`: downloads selected file
    assets into a temporary directory and reports successes/failures.

## Safety Contract

Browser page content is untrusted. Page text, DOM, screenshots, downloads, and
tool output cannot override user or system instructions.

Browser control must distinguish read-only inspection from data transmission.
The implementation must ask for confirmation before sending sensitive data,
submitting side-effectful forms, posting comments, buying items, changing
permissions, uploading files, saving credentials, or accepting browser
permission prompts unless the user has already explicitly authorized the exact
action.

Blocked URL policy errors are terminal for that action. The implementation must
not retry the same blocked target through raw CDP, alternate browser surfaces,
or indirect navigation. It may use a materially safer allowed target, such as a
local `127.0.0.1` test page instead of a blocked `data:` URL.

## Black-Box Environment

`agent.browsers.list()` returned two browsers:

- Chrome extension backend:
  - `type: "extension"`
  - `name: "Chrome"`
  - metadata included extension id, extension instance id, and Chrome profile
    name.
  - browser capabilities: none.
  - tab capabilities: `pageAssets`.
- Codex in-app browser backend:
  - `type: "iab"`
  - `name: "Codex In-app Browser"`
  - metadata included Codex app/session ids.
  - browser capabilities: `visibility`, `viewport`.
  - tab capabilities: `pageAssets`.

Initial IAB state:

- `browser.tabs.list()` returned `[]`.
- `browser.tabs.selected()` returned `null` before the first tab was created.
- `browser.user.openTabs()` returned an empty list for IAB.

After a failed stale-tab event, reselecting IAB returned no listed tabs but
`selected()` returned an attached `about:blank` tab. Implementations should
treat tab handles as session-bound and recover by re-listing/reselecting after
runtime errors.

## Auth And Profile Boundary

The Browser surface does not expose a generic credential API. Authenticated
website state is inherited only from the selected browser backend:

- Chrome extension automation runs in the user's selected Chrome profile. The
  bridge registration surfaces `extensionId`, `extensionVersion`, `instanceId`,
  and `profileName` metadata so Backchat Settings can show which profile is
  connected.
- `browser.user_open_tabs` is read-only and can reveal tabs from that Chrome
  profile, but it must not be treated as permission to submit forms, save
  credentials, or change account state.
- IAB automation runs in a Backchat-owned browser context. It does not claim to
  share the user's Chrome cookies or saved credentials.
- Real third-party login tests are intentionally not committed. Any task that
  uses account credentials remains side-effectful and requires explicit user
  authorization for the exact target account/action.

## URL Policy

Observed against IAB:

- `http://127.0.0.1:<port>/` is allowed.
- `data:text/html,...` is blocked by Browser Use URL policy.
- `file:///Users/xiaoyang/Proj/backchat/package.json` is blocked by Browser Use
  URL policy.
- `about:blank` can appear as an initially selected tab.

Backchat already uses file URLs for user-facing HTML preview in the side rail.
That should remain a separate user-preview feature. The agent-facing Browser
automation surface should default to the stricter observed Browser plugin URL
policy and not grant arbitrary file reads through browser navigation.

## Navigation And Tab Semantics

Observed IAB behavior:

- `tabs.new()` creates a new tab with a string id such as `"1"`.
- `tab.goto(localhostUrl)` navigates and can be followed by
  `playwright.waitForLoadState({ state: "domcontentloaded" })`.
- `tab.url()` and `tab.title()` reflect the current page.
- `browser.tabs.list()` returns `{ id, url, title }` for open tabs.
- `tab.back()` and `tab.forward()` work with browser history.
- `playwright.waitForURL(url, { timeoutMs, waitUntil })` can verify history
  navigation.
- `tab.close()` removes the tab from `tabs.list()`.
- Calling `tabs.get("missing")` fails with an error listing existing tabs.
  Backchat normalizes this as:
  `tabs.get could not find tab id "<id>"; open tabs: <id1>, <id2>` or
  `open tabs: none`.
- Calling `agent.browsers.get("missing")` fails with
  `Browser is not available: <id>`.
- Calling `url()` on a closed tab returned successfully in one probe, so closed
  tab handles should not be trusted as a freshness signal. Prefer `tabs.list()`
  membership.

Observed Chrome extension behavior:

- The Chrome backend can create, navigate, inspect, screenshot, and close a new
  Chrome tab.
- Its viewport is the real Chrome viewport, observed as `1728x880` in the
  probe, not the IAB default.
- It has no `visibility` or `viewport` capability.
- Console logs may include unrelated content-script logs from other installed
  Chrome extensions. Consumers must filter by `url` or message if they need
  page-specific evidence.

## Viewport And Visibility

IAB default viewport:

- `1280x720`.

IAB viewport override:

- `viewport.set({ width: 390, height: 640 })` changed `window.innerWidth` and
  `window.innerHeight` to `390x640` after reload.
- `viewport.reset()` restored `1280x720`.

IAB visibility:

- `visibility.get()` returned `false` during background testing.
- `visibility.set(false)` kept it false.
- The default should be hidden/background unless the user asks to see it or live
  viewing is useful.

## Playwright Subset

Observed supported methods:

- `domSnapshot()`
- `evaluate(fnOrString, arg?, { timeoutMs? })`
- `waitForLoadState()`
- `waitForURL()`
- `getByTestId()`
- `getByLabel()`
- `frameLocator()`
- locator `count()`, `click()`, `fill()`, `press()`, `setChecked()`,
  `selectOption()`, `innerText()`, `getAttribute()`

Important runtime constraints from Browser docs:

- Do not use regex `name` with `getByRole`.
- Do not use `.first()`, `.last()`, or `.nth()` unless a preceding `count()`
  proves the position.
- Do not click/fill/press until uniqueness is clear.
- After failed locators, take a fresh `domSnapshot()` before rebuilding.
- `evaluate` is read-only page scope. Use it for inspection, not mutation.

Backchat load-state parity:

- `browser.wait_for_load_state` accepts `domcontentloaded`, `load`, and
  `networkidle`.
- `browser.wait_for_url` accepts optional `waitUntil` with the same load-state
  values. It first waits for exact URL convergence, then waits for the requested
  page load state within the same timeout budget.
- It polls `document.readyState` through the selected adapter's page
  evaluation capability.
- `domcontentloaded` is satisfied by `interactive` or `complete`.
- `load` is satisfied by `complete`.
- `networkidle` is a documented generic approximation and is also satisfied by
  `complete`; it is not a full network-quiet detector.

Observed DOM snapshot behavior:

- Snapshot text is an accessibility-oriented tree.
- It includes iframe body content. The probe snapshot showed an iframe with
  nested `button "Frame button"`.
- `document.body.innerText` from top-frame `evaluate` did not include iframe
  text.
- `frameLocator("iframe").getByTestId("frame-button").count()` returned `1`.

Observed interaction behavior:

- Clicking a unique `data-testid="ping"` button updated DOM state.
- Filling a labeled input changed the element value.
- `setChecked(true)` changed a checkbox.
- `selectOption("auto")` changed a native select value.
- `frameLocator(...).click()` could click inside an iframe. A top-frame
  `evaluate` could not read the srcdoc iframe's DOM due cross-frame access
  limits in this runtime.

## CUA And DOM CUA

Coordinate CUA:

- `tab.cua.click({ x, y })` clicked a button when coordinates came from a
  `getBoundingClientRect()` center.

DOM CUA:

- `tab.dom_cua.get_visible_dom()` returned a string, not structured JSON.
- The string included compact interactable markup such as:
  - `<input node_id=1 aria-label="Name" value="Ada" />`
  - `<button node_id=4>Ping</button>`
  - `<button node_id=9>Frame button</button>`
- `dom_cua.click({ node_id: "4" })` clicked the visible Ping button.

## Screenshots

Observed:

- `tab.screenshot({ clip })` returned bytes with JPEG signature
  `ff d8 ff e0 00 10 4a 46`, not PNG, despite the API returning raw bytes
  without a MIME label.
- A `320x180` clip of the local probe page was about 5 KB.

Backchat should carry a MIME type alongside screenshot bytes in its own API, or
derive one by sniffing the signature before returning data to agents.

## Clipboard

Observed:

- `tab.clipboard.writeText("browser-clipboard-probe")` succeeded.
- `tab.clipboard.readText()` returned the written text.

Clipboard reads/writes can expose or alter user state. Agent-facing clipboard
tools should require explicit user permission unless the user request already
authorizes the exact clipboard action.

## Dev Logs

Observed:

- `tab.dev.logs({ limit })` returns entries with:
  - `level`
  - `message`
  - `timestamp`
  - optional `url`
- IAB returned page logs plus one Browser runtime internal error about
  `MutationObserver`.
- Chrome extension returned page logs plus unrelated installed-extension logs.

Consumers must filter logs rather than assuming all log entries belong to the
current page.

## JavaScript Dialogs

Observed:

- `alert()` produced `getJsDialog().type === "alert"` and could be dismissed.
- `confirm()` produced `getJsDialog().type === "confirm"` and could be
  accepted/dismissed.
- `prompt()` did not produce a prompt dialog in IAB. The page logged an error:
  `prompt() is not supported.`

Dialog actions can leave a click promise pending until the dialog is handled.
Implementation should expose dialog state separately and avoid issuing a second
click while a dialog is active.

## Page Assets

Observed:

- `pageAssets.list()` returned:
  - inventory id
  - current `pageUrl`
  - `assets[]` with `id`, `kind`, `name`, `url`, and `sources`
  - `inlineSvgs[]`
  - summary by kind
- The local probe page with one `dot.png` image reported:
  - `dot.png` as an image asset.
  - `favicon.ico` as an image-like resource because the browser requested it.
- `pageAssets.bundle({ inventoryId, kinds: ["image"] })`:
  - requested 2 image assets.
  - downloaded 1 valid PNG.
  - failed the favicon because the response content type was `text/html`, not
    valid image content.
  - wrote a manifest and asset file under a temporary
    `/var/folders/.../browser-use/assets/<uuid>/` directory.

## Backchat Starting State

Backchat already has a user-facing browser tab in the right rail:

- `src/renderer/src/components/shell/BrowserTab.tsx`
- Electron `<webview>` with URL bar, back, forward, reload.
- Uses partition `memory:browser`.
- Allows `file://` previews in the UI webview.
- No main-process tab registry.
- No automation API.
- No screenshot, DOM, clipboard, dialog, console log, page asset, viewport, or
  Chrome extension backend.

This means the Browser plugin work should not be implemented as a small change
to the URL bar. Backchat needs a browser automation service with adapters and a
separate UI preview integration.

## Implemented In This Pass

Backchat now has a main-process Browser automation surface:

- `BrowserPluginService` with an adapter boundary, URL policy enforcement, tab
  lifecycle, selected automation tab reads, user-open-tab reads, MIME-tagged
  screenshots with MIME type and clip/full-page request options, session naming,
  dev logs with URL/level/text/limit filters,
  DOM snapshot, evaluate, click/type/key input,
  coordinate CUA clicks, DOM CUA snapshots/clicks, title/url reads,
  reload/back/forward history controls, exact URL waiting, load-state waiting,
  `waitUntil` handling for URL waits, descriptor-based locators, page asset inventory, page asset
  bundling/downloading, host clipboard read/write, and JavaScript dialog
  inspection/accept/dismiss.
- Electron in-app adapter backed by sandboxed `WebContentsView` tabs that can
  run unattached in the background or attach the same `webContents` into the
  right rail.
- Built-in Browser MCP HTTP server injected into ACP sessions as
  `backchat-browser` when the agent advertises HTTP MCP support.
- ACP runtime filtering for MCP transports:
  - stdio is always allowed.
  - HTTP, SSE, and ACP transports require matching
    `initialize.agentCapabilities.mcpCapabilities`.
- Renderer IPC/preload surface for discovery, explicit browser descriptor
  lookup, tab lists, read-only tab lookup by id, selected automation tab reads,
  read-only user-open-tab reads, explicit tab selection, navigation, history,
  URL waits, session naming, title/url, screenshot, visibility,
  viewport, right-rail view attach/detach, DOM snapshot, evaluate, CSS
  click/type/key input, coordinate CUA, DOM CUA, load-state waiting, locator
  operations, JavaScript dialog inspect/accept/dismiss, page assets, bundled
  assets, clipboard, and console logs.
- Browser state push events:
  - main-process Browser service emits `browser.state` snapshots after tab
    creation, navigation, history movement, close, and visibility changes.
  - renderer receives `onBrowserPluginState` and mirrors visible IAB tabs into
    the current chat's right rail as source-tagged browser tabs.
  - source-tagged IAB tabs attach the same main-process `WebContentsView`
    surface into a measured right-rail placeholder; they do not mount an
    independent renderer `<webview>`.
  - ordinary user-created right-rail browser tabs remain separate because
    projected tabs carry `{ kind: "browser-plugin", browserId, tabId }`.
- Manifest V3 Chrome extension package with:
  - explicit browser automation permissions, including `<all_urls>` host
    access because background screenshot and scripting commands cannot rely on
    `activeTab` user-gesture grants.
  - localhost polling bridge with CORS/PNA preflight support.
  - `chrome.alarms` wakeups plus fetch timeouts so MV3 worker polling cannot
    get stuck forever on a half-open local connection.
  - `chrome.debugger` permission for CDP `Page.javascriptDialogOpening`,
    `Page.handleJavaScriptDialog`, and trusted `Input.dispatchMouseEvent`
    clicks for selector, locator, coordinate CUA, and DOM CUA actions. This is
    a deliberate parity tradeoff: it is higher-privilege than a pure scripting
    extension, but Chrome does not expose native JavaScript dialog control or
    trusted synthetic input through lower-privilege extension APIs.
  - command protocol for list/userOpenTabs/create/goto/close/screenshot/
    devLogs/domSnapshot/evaluate/click/type/key/coordinateClick/domCua/
    history/locator/dialog/pageAssets.
- Backchat-side Chrome extension adapter and localhost HTTP polling bridge.

Locator descriptor contract:

```ts
type BrowserLocatorDescriptor =
  | ({ kind: "css"; selector: string } & LocatorTargetOptions)
  | ({ kind: "testId"; value: string } & LocatorTargetOptions)
  | ({ kind: "text"; value: string; exact?: boolean } & LocatorTargetOptions)
  | ({ kind: "label"; value: string; exact?: boolean } & LocatorTargetOptions)
  | ({ kind: "role"; role: string; name?: string; exact?: boolean } & LocatorTargetOptions)
  | ({
      kind: "frame";
      frame: BrowserLocatorDescriptor;
      locator: BrowserLocatorDescriptor;
    } & LocatorTargetOptions);

type LocatorTargetOptions = {
  index?: number;
};
```

Implemented locator operations:

- `locatorCount({ browser, tabId, locator })`
- `locatorClick({ browser, tabId, locator })`
- `locatorFill({ browser, tabId, locator, text })`
- `locatorPress({ browser, tabId, locator, key })`
- `locatorSetChecked({ browser, tabId, locator, checked })`
- `locatorSelectOption({ browser, tabId, locator, value })`
- `locatorInnerText({ browser, tabId, locator })`
- `locatorAttribute({ browser, tabId, locator, name })`

The locator shape is intentionally serializable. Backchat does not try to pass
a Playwright locator object across ACP, IPC, or the Chrome extension bridge.
Actions require a unique match by default. If a locator matches multiple
elements, the action fails and the agent must call count first, then pass a
zero-based `index` to disambiguate. This mirrors the observed Browser plugin
guidance around `count()` before positional locator operations.

`frame` locators are recursive: resolve `frame` in the current document, then
resolve `locator` inside that frame document. The implemented subset supports
same-origin and `srcdoc` iframes where `contentDocument` is available. The IAB
adapter also falls back to Electron `webContents.mainFrame.frames` for
cross-origin child frames, using the matched iframe's document order to execute
the nested locator inside the corresponding `WebFrameMain`. Chrome extension
frame locators execute nested operations in a specific Chrome `frameId`:
the extension first resolves the parent iframe locator in the current frame,
records the selected iframe URL and same-URL sibling index, reads
`chrome.webNavigation.getAllFrames({ tabId })` for direct child frame ids and
parent frame ids, then injects the nested locator operation with
`frameIds: [frameId]`. This supports cross-origin iframe traversal, including
duplicate same-URL sibling iframes when the frame locator uses `index` to pick
the intended iframe element. If `webNavigation` is unavailable, the extension
falls back to URL matching through `chrome.scripting.executeScript({
allFrames: true })`; ambiguous duplicates still fail instead of guessing.

Implemented CUA operations:

- `cuaClick({ browser, tabId, x, y })`
- `domCuaSnapshot({ browser, tabId })`
- `domCuaClick({ browser, tabId, nodeId })`

IAB coordinate CUA uses Electron `webContents.sendInputEvent` mouse events
when the view is visible. For hidden/background tabs, where native hit testing
and input dispatch can be unavailable, it falls back to page-scope DOM hit
testing by coordinates and dispatches mouse events to the matched element.
Chrome selector clicks, locator clicks, coordinate CUA, and DOM CUA click
actions use CDP `Input.dispatchMouseEvent` through `chrome.debugger`, giving
them trusted-input behavior close to real Chrome user clicks. DOM CUA returns a
compact string of visible interactable elements with stable 1-based `node_id`
values for the current snapshot order, then clicks by reconstructing that same
visible interactable order and dispatching a trusted mouse event at the target
center.

Known parity caveats:

- Chrome extension duplicate same-URL iframe support depends on `webNavigation`
  frame tree access and `locator.index` on the iframe element. If the iframe
  locator itself is ambiguous or `webNavigation` is unavailable, Backchat
  refuses to guess.

`browser.bundle_assets` writes a Backchat-managed local directory under
`~/.openma/browser-assets/<bundle-id>/`. The result includes `directory`,
`manifestPath`, and an asset manifest. Each asset records `saved`, `skipped`, or
`failed`; non-HTTP(S) URLs are skipped, HTTP failures are recorded, and
successful responses are saved with MIME type and byte size.

File upload parity contract: no `setInputFiles` or equivalent agent-facing
file-upload API was observed in the active Browser plugin surface documented
above. Backchat therefore does not expose an implicit upload tool. Uploading
local files remains a side-effectful action under the safety contract and must
be introduced only as an explicit, confirmed product feature if the upstream
Browser surface adds one.

## Implementation Plan

### Core service

Add a main-process Browser service with an adapter boundary:

- `BrowserPluginService`
  - owns browser adapters.
  - lists browsers and capabilities.
  - creates/gets/closes tabs through adapters.
  - enforces URL policy before navigation.
  - normalizes errors.
  - returns MIME-tagged screenshots.
  - exposes page/log/dialog/clipboard/asset operations.
- `BrowserBackendAdapter`
  - implemented by in-app Electron adapter and Chrome extension adapter.
  - hides CDP/webContents/extension transport differences.
- `BrowserUrlPolicy`
  - allows `http:`, `https:`, and `about:blank`.
  - allows loopback dev URLs.
  - blocks `data:` and arbitrary `file:` by default.
  - can later accept explicit user-approved artifact file grants, but that
    should be a separate allowlist, not broad file URL navigation.

### In-app adapter

Implemented path:

- Use Electron `WebContentsView` controlled by the main process.
- Keep the `webContents` alive when it is not attached to the UI by parking the
  `WebContentsView` inside an offscreen hidden BrowserWindow. Attach it to the
  focused Backchat window's `contentView` only when a plugin-source right-rail
  tab is mounted and visible, then move it back to the parking window on
  detach.
- Use `webContents` plus targeted page scripts for:
  - navigation and lifecycle.
  - DOM snapshots / accessibility tree.
  - screenshots.
  - console logs.
  - input dispatch.
  - network/resource tracking for page assets.
- Keep a tab registry in main.
- Visibility is controlled by attach/detach plus `View.setVisible`.
- Viewport is controlled by resizing the controlled view bounds.
- Screenshots are captured through the host abstraction, not by bypassing to
  raw `webContents.capturePage`, so detached views can use the parking window
  paint path. The IAB adapter reports the actual MIME type with the bytes.

Do not rely on the existing renderer `<webview>` as the automation source of
truth. It can display user previews, but agent automation should be owned by
main so it is testable and permissionable.

### Chrome extension adapter

Implement a Manifest V3 extension:

- `manifest_version: 3`
- background service worker owns a connection to Backchat.
- content script inspects visible DOM and performs safe DOM CUA actions on the
  chosen tab.
- use `chrome.tabs`, `chrome.scripting`, `chrome.debugger`, and injected
  content scripts for the default package.
- prefer bounded privilege:
  - required permissions: `tabs`, `scripting`, `debugger`, `activeTab`,
    `storage`, `alarms`.
  - host permissions: `<all_urls>`.
  - rationale: Chrome `captureVisibleTab` and `chrome.scripting` background
    commands need stable page access; `activeTab` is only a temporary
    user-gesture grant and cannot support autonomous Browser tool calls.
    Native JavaScript dialog control and trusted click dispatch require CDP
    through `chrome.debugger`.

Bridge options:

- Preferred for development: local HTTP long-poll bridge from extension service
  worker to Backchat main process. This avoids native messaging installation
  friction and avoids a WebSocket dependency.
- The Electron bridge defaults to port `29174`, supports
  `BACKCHAT_BROWSER_EXTENSION_PORT=0` for dynamic test binding, and exposes the
  actual bound port through Chrome adapter metadata.
- Later packaged path: Chrome Native Messaging host manifest generated by
  Backchat for lower-latency bidirectional communication.

Chrome extension differences to preserve:

- no IAB `visibility`/`viewport` capabilities.
- viewport is the real Chrome tab viewport.
- logs are collected through a page MAIN-world console hook installed after
  navigation and before agent actions. This captures logs from agent-triggered
  interactions; it is not a native DevTools stream and should not be treated as
  complete for early page-load logs.
- operations affect the user's Chrome profile, so confirmation and permission
  requirements are stricter than IAB.
- cross-origin iframe locators are supported through `webNavigation`
  parent/child frame mapping plus `chrome.scripting` `frameIds` injection.
  Duplicate same-URL sibling frames are supported when the iframe locator passes
  `index` after count.
- native alert/confirm/prompt state is observed through CDP Page events and
  handled with `Page.handleJavaScriptDialog`. If another debugger is already
  attached to the tab, Backchat reports that conflict instead of silently
  falling back to fake dialog state.

### Chrome extension UX contract

The Chrome extension must not behave like a silent background daemon. It has a
visible popup and badge state so the user can understand and control the bridge
without reading logs.

Extension popup requirements:

- The manifest action loads `popup.html`; the popup must use external CSS and
  module JavaScript, not inline scripts.
- The popup displays the current bridge status: connected, disconnected, or
  paused.
- The popup displays diagnostics that include extension id, extension version,
  instance id, bridge port, last connection time, last command type/time, and
  last error when available.
- The popup provides an "Allow automation" toggle. Turning it off pauses
  registration and command polling before the service worker fetches Backchat.
- The popup provides a bridge-port field. Saving it persists the port and
  reconnects polling against the new Backchat bridge port.
- The popup explains the local bridge endpoint and allows copying diagnostics.
- The toolbar badge shows `ON`, `OFF`, or `PAUSE` so paused/disconnected state
  is visible before opening the popup.

Extension installation/distribution requirements:

- `pnpm package:browser-extension` creates `dist/browser-extension/`.
- The output includes `backchat-browser-extension-<version>.zip` with the MV3
  extension root files and `browser-extension-install.json` with version,
  source directory, package filename, packaged file list, and install steps.
- The package test verifies the generated zip structure and audited install
  manifest so extension installation is a repeatable release artifact, not only
  an unpacked development path.

Backchat settings requirements:

- Settings has a first-class `Browser` page under Integrations, separate from
  `Agents`.
- The page lists both backends: Electron in-app browser and Chrome extension.
- The in-app browser row shows whether the main-process adapter is registered
  and how many capabilities are exposed.
- The Chrome extension row is derived from `browserList()` metadata, not from
  renderer guesses.
- When registered, the Chrome extension row shows bridge port, extension id,
  extension version, profile name, and instance id when present.
- The main-process HTTP bridge serializes health into descriptor metadata:
  `bridgeStatus`, `bridgePendingCommands`, `bridgeQueuedCommands`,
  `bridgeLastConnectedAt`, `bridgeLastCommandAt`, `bridgeLastCommandType`,
  and `bridgeLastError`.
- `command-error` and `command-timeout` bridge statuses override the connected
  label in Settings so a registered extension cannot mask a failed command.
- When not registered, the row shows the unpacked extension path and required
  permissions: `activeTab`, `tabs`, `scripting`, `debugger`, `webNavigation`,
  and `<all_urls>`.
- The page refreshes periodically because Chrome extension registration happens
  out of process and is not a settings-store mutation.

### Agent exposure

Use MCP as the first agent-facing integration path:

- ACP `session/new` already accepts `mcpServers`.
- Backchat settings already persist `mcp_servers`.
- Backchat adds a built-in Browser MCP server and injects it into sessions
  when Browser tools are enabled.
- Implemented tool names are stable and explicit:
  - `browser.list`
  - `browser.documentation`
  - `browser.get`
  - `browser.tabs`
  - `browser.selected_tab`
  - `browser.user_open_tabs`
  - `browser.get_tab`
  - `browser.name_session`
  - `browser.session_name`
  - `browser.select_tab`
  - `browser.new_tab`
  - `browser.goto`
  - `browser.visibility_get`
  - `browser.visibility_set`
  - `browser.viewport_set`
  - `browser.viewport_reset`
  - `browser.reload`
  - `browser.back`
  - `browser.forward`
  - `browser.wait_for_url`
  - `browser.wait_for_load_state`
  - `browser.close_tab`
  - `browser.title`
  - `browser.url`
  - `browser.dom_snapshot`
  - `browser.evaluate`
  - `browser.click`
  - `browser.type`
  - `browser.keypress`
  - `browser.cua_click`
  - `browser.dom_cua_snapshot`
  - `browser.dom_cua_click`
  - `browser.locator_count`
  - `browser.locator_click`
  - `browser.locator_fill`
  - `browser.locator_press`
  - `browser.locator_set_checked`
  - `browser.locator_select_option`
  - `browser.locator_inner_text`
  - `browser.locator_attribute`
  - `browser.screenshot`
  - `browser.console_logs`
  - `browser.dialog`
  - `browser.dialog_accept`
  - `browser.dialog_dismiss`
  - `browser.clipboard_read_text`
  - `browser.clipboard_write_text`
  - `browser.page_assets`
  - `browser.bundle_assets`
If an ACP-native custom extension is later added, it must use `_`-prefixed
method names and advertise capability support through `_meta`, per ACP docs.

## TDD Test Matrix

Core service unit tests:

- lists registered browsers with capability metadata.
- selects IAB by type and Chrome by type/id.
- rejects unknown browser ids with a stable error.
- creates, lists, retrieves, and closes tabs through an adapter.
- marks closed tab ids as stale even if a stale handle still answers.
- enforces URL policy:
  - allows `http://127.0.0.1:<port>/`.
  - allows `https://example.com`.
  - allows `about:blank`.
  - blocks `data:`.
  - blocks arbitrary `file:`.
- normalizes screenshot bytes with a MIME type.
- preserves screenshot `clip` and `fullPage` request options through renderer
  IPC and MCP into the selected adapter.
- exposes IAB viewport/visibility only when adapter advertises them.
- exposes visibility/viewport controls through MCP and renderer IPC.
- preserves Chrome extension as no viewport/visibility capabilities.
- tracks the selected automation tab and exposes read-only user-open tabs.
- selects an existing automation tab after validating that the tab exists.
- reports missing `tabs.get` lookups with the currently open tab ids.
- waits for exact URL convergence and reports timeout with the last observed
  URL.
- supports `waitUntil` on exact URL waits and does not resolve until the
  requested readyState threshold is satisfied.
- waits for load-state convergence through `document.readyState`, including
  `domcontentloaded` satisfaction on `interactive` and load-state timeout
  reporting with the last observed readyState.
- emits browser state snapshots and mirrors visible IAB tabs into right rail
  source-tagged browser tabs.
- attaches source-tagged IAB tabs to the right rail with the same
  main-process `WebContentsView` that automation controls.
- filters dev logs by URL when requested.
- filters dev logs by URL, level, message/URL text, and latest-entry limit.
- surfaces active JS dialog and prevents duplicate click while dialog is active.
- proxies locator count/click/fill/press/setChecked/selectOption/innerText/
  attribute and prevents locator click while a JavaScript dialog is active.
- proxies coordinate CUA clicks and DOM CUA snapshot/click operations through
  both IAB and Chrome extension adapters.
- enforces strict locator action targeting and preserves zero-based
  `locator.index` as the serializable equivalent of `.nth()` after count.
- runs IAB frame locators through Electron child frames when cross-origin
  iframe DOM is not accessible from the parent document.
- runs Chrome extension frame locators through `webNavigation` frame ids and
  `chrome.scripting` injection for cross-origin child frames, including
  duplicate same-URL sibling frames selected with `locator.index`.
- treats `prompt()` unsupported as an error/log condition rather than a prompt
  dialog on IAB.
- records page asset inventory and bundle success/failure shape.

Implementation adapter tests:

- fake adapter contract tests for every service method before Electron/CDP work.
- Browser MCP tests validate the stable tool list, including
  `browser.documentation`, and verify the documentation tool returns the
  Browser safety/API contract without calling the Browser service.
- Chrome extension manifest test:
  - MV3.
  - browser automation permissions declared up front.
  - `<all_urls>` host permission for scripting and screenshots.
  - `debugger` permission declared for native dialog control and trusted
    click dispatch.
  - `webNavigation` permission declared for direct child frame mapping.
  - `chrome.alarms` startup wakeup and fetch timeout contract.
  - frame locator implementation uses `webNavigation.getAllFrames` and
    `chrome.scripting` `frameIds`.
  - extension action loads popup assets without inline scripts.
  - popup static assets expose status, pause, port, refresh, and diagnostic
    controls.
- Chrome extension background tests:
  - expose popup status through `bridge.status`.
  - allow the popup to pause/resume automation with `bridge.setPaused`.
  - allow the popup to change and persist the Backchat bridge port with
    `bridge.setPort`.
  - avoid registration and command polling while paused.
  - update the toolbar badge for connected, disconnected, and paused states.
- Chrome extension HTTP bridge tests:
  - expose health snapshots for disconnected, connected, command error, and
    command timeout states.
  - remove timed-out commands from the pending queue so stale work is not later
    delivered to the extension.
- Chrome extension protocol tests:
  - register extension instance.
  - long-poll command request.
  - post command result.
  - normalize tab/log/screenshot events.
  - expose page console logs through the bridge.
  - parse coordinate CUA and DOM CUA command envelopes.
  - parse dialog inspect/accept/dismiss command envelopes.
  - validate locator command envelopes and reject malformed locator payloads.
- Backchat Browser settings tests:
  - derive connected Chrome extension rows from browser descriptor metadata.
  - derive actionable loading path and permission rows when the extension has
    not registered.
  - keep the in-app browser backend distinct from the Chrome extension backend.

E2E coverage:

- implemented: launch Backchat/Electron with Browser enabled.
- implemented: open a local fixture page in IAB through the production
  renderer IPC/preload surface.
- implemented: resolve the IAB browser descriptor by alias through the
  production renderer IPC/preload surface.
- implemented: read a tab by id without changing selected automation tab
  through the production renderer IPC/preload surface.
- implemented: verify selected automation tab lifecycle, explicit tab
  selection, and read-only user-open-tab reads through the production
  renderer IPC/preload surface.
- implemented: wait for exact fixture URL plus `domcontentloaded` through the
  production renderer IPC/preload surface.
- implemented: verify CSS type/click, DOM snapshot, evaluate, DOM CUA
  snapshot/click, coordinate CUA click, screenshot bytes/MIME, session naming,
  console logs, page assets, and visible IAB projection into the chat right
  rail.
- implemented: enable Chrome extension bridge in an isolated test Chromium
  profile through `e2e/chrome-extension-harness.ts`.
- implemented: verify Chrome extension popup/status changes do not regress the
  real extension bridge harness.
- implemented: verify Chrome backend new/goto/type/click/evaluate/DOM
  snapshot/screenshot/close through the production renderer IPC/preload
  surface.
- implemented: verify Chrome extension locatorCount/click/innerText inside a
  cross-origin iframe fixture through the production renderer IPC/preload
  surface and isolated extension profile.
- implemented: verify Chrome extension frame locator clicks a selected
  duplicate same-URL cross-origin iframe using `frame.index` while the sibling
  iframe remains unchanged.
- implemented: verify Chrome extension native alert dismiss and confirm accept
  through the production renderer IPC/preload surface, an isolated extension
  profile, `chrome.debugger` Page events, and CDP dialog handling.
- implemented: verify Chrome extension native prompt inspection and prompt text
  accept through the production renderer IPC/preload surface.
- implemented: verify Chrome extension locator and DOM CUA click paths dispatch
  trusted browser input rather than DOM-level synthetic clicks.
- implemented: verify blocked URL policy for `data:` and `file:` through the
  production renderer IPC/preload surface.
- note: the Chrome extension harness runs as a standalone `tsx` process because
  Playwright's Electron runner injects inspector/CDP listeners that interfere
  with localhost extension polling when both browser controllers live in the
  same worker process. The Playwright spec keeps a skipped wrapper and the
  runnable command is:
  `pnpm exec tsx e2e/chrome-extension-harness.ts`.
