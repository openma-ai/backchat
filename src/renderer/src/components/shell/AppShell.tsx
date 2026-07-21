import * as React from "react";
import { useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { getThemePlugin } from "@/themes";

/**
 * AppShell — three-slot stage. Left sidebar and (optional) right side-
 * chat panel are absolutely positioned floating cards on a tinted
 * stage; the main column sits between them and contains the topbar +
 * routed page.
 *
 *   collapsed:  sidebar/rail translate off-screen + opacity 0 + scale(0.96)
 *               main padding shrinks to stage-inset
 *   open:       sidebar/rail translateX(0) + opacity 1 + scale(1)
 *               main padding expands to make room
 *
 * All transitions share one easing curve so the two sides feel coupled.
 *
 * The right side is intentionally a SECOND chat surface, not a tools/
 * properties rail — Codex-style "side conversation" pattern: an
 * independent thread that can run a separate ACP session while the
 * main chat continues. The rail's geometry mirrors the sidebar exactly
 * (same animation, same card material) so the shell reads as
 * symmetric, not as a sidebar + sidekick.
 */

const SIDEBAR_W = 240;
const MIN_RAIL_W = 200;
const MAX_RAIL_W = 560;
const SIDEBAR_TR =
  "transform 280ms cubic-bezier(0.32, 0.72, 0, 1), opacity 220ms cubic-bezier(0.32, 0.72, 0, 1), bottom 280ms cubic-bezier(0.32, 0.72, 0, 1)";
const MAIN_TR =
  "padding-left 280ms cubic-bezier(0.32, 0.72, 0, 1), padding-right 280ms cubic-bezier(0.32, 0.72, 0, 1), padding-bottom 280ms cubic-bezier(0.32, 0.72, 0, 1)";
const BOTTOM_TR =
  "transform 280ms cubic-bezier(0.32, 0.72, 0, 1), opacity 220ms cubic-bezier(0.32, 0.72, 0, 1)";
const WINDOW_RESIZE_SETTLE_MS = 180;

export type CollapseState = boolean;

export const SidebarCollapseContext = React.createContext<{
  collapsed: CollapseState;
  toggle: () => void;
  set: (value: boolean) => void;
}>({ collapsed: false, toggle: () => {}, set: () => {} });

export function useSidebarCollapse() {
  return React.useContext(SidebarCollapseContext);
}

export const RightRailCollapseContext = React.createContext<{
  collapsed: CollapseState;
  toggle: () => void;
  set: (value: boolean) => void;
}>({ collapsed: true, toggle: () => {}, set: () => {} });

export function useRightRailCollapse() {
  return React.useContext(RightRailCollapseContext);
}

export const BottomBarCollapseContext = React.createContext<{
  collapsed: CollapseState;
  toggle: () => void;
  set: (value: boolean) => void;
}>({ collapsed: true, toggle: () => {}, set: () => {} });

export function useBottomBarCollapse() {
  return React.useContext(BottomBarCollapseContext);
}

export function AppShell({
  sidebar,
  topbar,
  rightPanel,
  bottomPanel,
  children,
  className,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  rightPanel?: React.ReactNode;
  bottomPanel?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  useWindowResizePerformanceMode();
  const { collapsed: leftCollapsed } = useSidebarCollapse();
  const { collapsed: rightCollapsed } = useRightRailCollapse();
  const { collapsed: bottomCollapsed } = useBottomBarCollapse();
  const [bottomHeight, setBottomHeight] = useBottomPanelHeight();
  const { themeId, effective } = useTheme();
  const themeSidebarWidth = getThemePlugin(themeId, effective).layout?.sidebarWidth ?? SIDEBAR_W;
  // Suppress slide/easing transitions while the user is dragging the
  // resize handle — without this, every move event queues a fresh
  // 280 ms animation and the cursor visibly lags the panel edge.
  const [resizing, setResizing] = React.useState(false);
  const [sidebarWidth, setSidebarWidth] = React.useState(themeSidebarWidth);
  const [rightRailWidth, setRightRailWidth] = React.useState(380);
  const hasTopbar = topbar != null;

  React.useEffect(() => {
    setSidebarWidth(themeSidebarWidth);
  }, [themeId, themeSidebarWidth]);

  // Where the bottom edge of the main column + the side rail sits when
  // the bottom panel is open. The panel is a floating rounded card
  // with stage-inset gap on all four sides; the side rail and main
  // column reserve panel-height + 2*stage-inset above it so the gap
  // between rail and panel reads as the same stage band shown on
  // every other side.
  // Sidebar keeps its full height (bottom: --stage-inset) because the
  // panel doesn't extend under it.
  const bottomReservation = bottomCollapsed || !bottomPanel
    ? "var(--stage-inset)"
    : "calc(var(--bottom-panel-h) + var(--stage-inset) * 2)";

  return (
    <div
      className={cn(
        "relative h-full bg-bg-sidebar text-fg",
        className,
      )}
      style={{
        "--bottom-panel-h": `${bottomHeight}px`,
        "--sidebar-w": `${sidebarWidth}px`,
        "--right-rail-w": `${rightRailWidth}px`,
      } as React.CSSProperties}
    >
      <div className="theme-app-background" aria-hidden="true" />
      {/* Left sidebar — absolute floating card. Spans full height
          regardless of bottom panel state (the bottom panel is inset
          to the main column's x-range). */}
      <aside
        className={cn(
          "absolute flex flex-col overflow-hidden transform-gpu",
          "liquid-glass theme-sidebar-background rounded-2xl",
        )}
        style={{
          left: "var(--stage-inset)",
          top: "var(--stage-inset)",
          bottom: "var(--stage-inset)",
          width: `${sidebarWidth}px`,
          transform: leftCollapsed
            ? `translateX(calc(-100% - var(--stage-inset))) scale(0.96)`
            : "translateX(0) scale(1)",
          opacity: leftCollapsed ? 0 : 1,
          transformOrigin: "left center",
          transition: SIDEBAR_TR,
          pointerEvents: leftCollapsed ? "none" : "auto",
          zIndex: 20,
        }}
        aria-hidden={leftCollapsed}
      >
        {sidebar}
        <RailResizer side="right" width={sidebarWidth} onResize={setSidebarWidth} onResizingChange={setResizing} />
      </aside>

      {/* Right side-chat panel — mirror of the sidebar. Only mounts when
          a rightPanel prop is provided AND it's not collapsed. Collapsed
          state defaults to true so users opt in to the side-chat surface
          (the main thread is the primary affordance). */}
      {rightPanel && (
        <aside
          className={cn(
            "absolute flex flex-col overflow-hidden transform-gpu",
            "liquid-glass rounded-2xl",
          )}
          style={{
            right: "var(--stage-inset)",
            top: "var(--stage-inset)",
            bottom: bottomReservation,
            width: `${rightRailWidth}px`,
            transform: rightCollapsed
              ? `translateX(calc(100% + var(--stage-inset))) scale(0.96)`
              : "translateX(0) scale(1)",
            opacity: rightCollapsed ? 0 : 1,
            transformOrigin: "right center",
            transition: resizing ? "none" : SIDEBAR_TR,
            pointerEvents: rightCollapsed ? "none" : "auto",
            zIndex: 20,
          }}
          aria-hidden={rightCollapsed}
        >
          {rightPanel}
          <RailResizer side="left" width={rightRailWidth} onResize={setRightRailWidth} onResizingChange={setResizing} />
        </aside>
      )}

      {/* Main region — paddingLeft/Right expand/contract to match each
          floating card's footprint. Same easing curve as the cards'
          slide so all motions feel coupled. */}
      <div
        className="flex h-full min-h-0 flex-col"
        style={{
          // Main region's padding = rail width + a single `stage-inset`
          // (6px) of geometric gap. The full `stage-inset * 2` (12px)
          // from the original formula left a 6px visual gap between
          // the chat and each rail; halving it to 6px geometric gives
          // ~2px visual clearance after the rail's liquid-glass blur
          // halo + border eats ~4px. Result: the chat scrollbar pill
          // sits right at the rail's halo edge — close enough to read
          // as "flush", with enough room to not get visually clipped
          // by the rail's backdrop-filter.
          paddingLeft: leftCollapsed
            ? "var(--stage-inset)"
            : `calc(${sidebarWidth}px + var(--stage-inset))`,
          paddingRight: rightCollapsed || !rightPanel
            ? "var(--stage-inset)"
            : `calc(${rightRailWidth}px + var(--stage-inset))`,
          paddingBottom: bottomReservation,
          transition: resizing ? "none" : MAIN_TR,
        }}
      >
        {hasTopbar && (
          <header
            className="app-drag-region flex shrink-0 items-center gap-2"
            style={{
              // 50px so the items-center content (folder/label/cancel) lands
              // at center y = 25, matching the trafficLight center (y=18+7)
              // and the global toggle center (y=13+12). All three "top
              // chrome" row elements share one baseline.
              height: "50px",
              paddingLeft: leftCollapsed
                ? // 16 px trafficLight left + 58 px trafficLight width +
                  // chrome-gap + chrome-size (sidebar toggle) + chrome-gap.
                  // Same chrome-gap appears on the right side between the
                  // terminal toggle and the side-panel edge, so the two
                  // seams read symmetric.
                  "calc(16px + 58px + var(--chrome-gap) + var(--chrome-size) + var(--chrome-gap))"
                : "var(--page-pl)",
              paddingRight: "calc(var(--page-pr) / 2)",
              transition: "padding-left 280ms cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          >
            {topbar}
          </header>
        )}
        <main
          // Pages own their own scrolling (e.g. <Conversation> uses
          // use-stick-to-bottom, SettingsLayout wraps in its own
          // overflow-y-auto). Keeping AppShell's <main> non-scrolling
          // means no permanent scrollbar gutter is reserved on the
          // right — otherwise the chat scroller's right edge sits
          // 10 px short of where the right rail begins, producing a
          // visible gap on the chat page. Other pages that need
          // a scrolling <main> (Settings) declare it themselves.
          className="relative min-h-0 flex-1"
          style={{ paddingTop: hasTopbar ? undefined : "var(--stage-inset)" }}
        >
          {children}
        </main>
      </div>

      {/* Bottom panel — floating rounded card. Plain white card (NOT
          liquid-glass) because xterm-addon-webgl draws on an opaque
          framebuffer; layering a transparent glass card with an opaque
          terminal inside reads as a "white slab inside a translucent
          card" (image #10). Soft shadow approximates the lift the
          liquid-glass cards get from their own box-shadow, so the
          panel still reads as "floating on the stage" even though its
          material is different. */}
      {bottomPanel && (
        <div
          className={cn(
            "absolute overflow-hidden transform-gpu",
            "rounded-2xl bg-bg border border-border/60",
          )}
          style={{
            left: leftCollapsed
              ? "var(--stage-inset)"
              : `calc(${SIDEBAR_W}px + var(--stage-inset) * 2)`,
            right: "var(--stage-inset)",
            bottom: "var(--stage-inset)",
            height: "var(--bottom-panel-h)",
            transform: bottomCollapsed
              ? `translateY(calc(100% + var(--stage-inset))) scale(0.98)`
              : "translateY(0) scale(1)",
            opacity: bottomCollapsed ? 0 : 1,
            transformOrigin: "center bottom",
            transition: resizing
              ? "none"
              : BOTTOM_TR +
                ", left 280ms cubic-bezier(0.32, 0.72, 0, 1)",
            pointerEvents: bottomCollapsed ? "none" : "auto",
            zIndex: 18,
          }}
          aria-hidden={bottomCollapsed}
        >
          {/* Drag handle — sits on the panel's top edge. 6 px tall hit
              zone, invisible by default, faint highlight on hover. Drag
              changes --bottom-panel-h via setBottomHeight. */}
          <BottomPanelResizer
            onResize={setBottomHeight}
            onResizingChange={setResizing}
          />
          {bottomPanel}
        </div>
      )}

      {/* Global sidebar toggle — fixed at trafficLight's right side.
          Constant screen position across collapsed/open, so toggling
          doesn't make the icon jump. */}
      <GlobalSidebarToggle />
      {/* Right-rail / bottom-panel toggles only show inside a chat
          context. On `/` (no active chat) + on /settings the user
          hasn't picked anything to talk about yet, and the side / bottom
          surfaces would just dangle. The page-level UI re-shows them
          via TopChromeButtons when relevant. */}
      <ChromeToggles
        rightPanel={!!rightPanel}
        bottomPanel={!!bottomPanel}
      />
    </div>
  );
}

/**
 * Live macOS window resizing continuously resizes Electron webview surfaces.
 * The guest surface and the translucent full-height rail otherwise repaint on
 * different frames, which makes the rail flash and lag behind the window edge.
 * Toggle a DOM-only mode during the drag so CSS can use an opaque equivalent,
 * then restore the resting material once the native resize stream settles.
 * Keeping this outside React avoids reconciling the shell on every event.
 */
function useWindowResizePerformanceMode(): void {
  React.useEffect(() => {
    const root = document.documentElement;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const handleResize = () => {
      root.dataset.windowResizing = "true";
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        delete root.dataset.windowResizing;
        settleTimer = undefined;
      }, WINDOW_RESIZE_SETTLE_MS);
    };

    window.addEventListener("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      if (settleTimer) clearTimeout(settleTimer);
      delete root.dataset.windowResizing;
    };
  }, []);
}

/** Renders the side-chat + terminal toggles ONLY when the current
 *  route is a chat (`/chat/$sessionId`). On `/` (home, no session)
 *  and `/settings/*` the toggles are hidden — those surfaces have
 *  nothing to dock with the side / bottom panels. The chat route
 *  drives the gate so users land somewhere meaningful before the
 *  rail / panel re-appear. */
function ChromeToggles({
  rightPanel,
  bottomPanel,
}: {
  rightPanel: boolean;
  bottomPanel: boolean;
}) {
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith("/chat/");
  if (!isChatRoute) return null;
  return (
    <>
      {rightPanel && <GlobalSideChatToggle />}
      {bottomPanel && <GlobalTerminalToggle hasRightPanel={rightPanel} />}
    </>
  );
}

function GlobalSideChatToggle() {
  const { collapsed, toggle } = useRightRailCollapse();
  // When the panel is expanded, the toggle lives INSIDE the panel
  // header (see SideChatPanel.tsx) — render nothing on the stage.
  // When collapsed, the panel header isn't visible, so the stage
  // toggle is the only way to re-open.
  if (!collapsed) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Open side panel" : "Close side panel"}
      title={collapsed ? "Open side panel" : "Close side panel"}
      className={cn(
        "app-no-drag fixed inline-flex size-6 items-center justify-center rounded-md z-50",
        "text-fg-subtle hover:bg-bg-surface hover:text-fg",
        "transition-colors",
      )}
      style={{
        // Mirror the left toggle's y. The right toggle slides with the
        // rail's outer edge so it sits inside the stage gap when open
        // and reaches the viewport edge when collapsed — same visual
        // anchor (rail's left edge ± inset) at both states.
        right: collapsed
          ? "calc(var(--chrome-gap) / var(--zoom, 1))"
          : "calc(var(--right-rail-w) + var(--stage-inset) + var(--chrome-gap) / var(--zoom, 1))",
        top: "var(--chrome-top)",
        transition: "right 280ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Card-with-right-strip glyph — visually the mirror of the
            left toggle so users read the pair as "open the panel on
            THIS side". */}
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <line x1="10" y1="3" x2="10" y2="13" />
      </svg>
    </button>
  );
}

function GlobalSidebarToggle() {
  const { collapsed, toggle } = useSidebarCollapse();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        "app-no-drag fixed inline-flex size-6 items-center justify-center rounded-md z-50",
        "text-fg-subtle hover:bg-bg-surface hover:text-fg",
        "transition-colors",
      )}
      style={{
        // Toggle x must stay at chrome_x = 30*z + 60 (trafficLight right
        // edge + 8px gap). Since `fixed` renderer px multiply by zoom to
        // get chrome px, the renderer left = chrome_x / z = 30 + 60/z.
        // Falls back to 90 (z=1 case) if --zoom isn't set yet.
        left: "calc(30px + 60px / var(--zoom, 1))",
        top: "var(--chrome-top)",
      }}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <line x1="6" y1="3" x2="6" y2="13" />
      </svg>
    </button>
  );
}

function GlobalTerminalToggle({ hasRightPanel }: { hasRightPanel: boolean }) {
  const { collapsed, toggle } = useBottomBarCollapse();
  const { collapsed: rightCollapsed } = useRightRailCollapse();
  // Symmetric with the side-chat toggle: render only when the bottom
  // panel is collapsed. When expanded, BottomPanel.tsx renders its
  // own "X" in the header which closes the panel (== toggle to
  // collapsed). One re-open affordance, one close affordance, never
  // both at once.
  if (!collapsed) return null;
  // Park to the LEFT of the side-chat toggle / panel. Two states:
  //   - side panel OPEN: terminal toggle's right edge sits
  //     `var(--chrome-gap)` from the panel's left edge — matches the
  //     LEFT sidebar's `GlobalSidebarToggle` gap, which is also
  //     `var(--chrome-gap)` from the trafficLight right edge
  //     (see AppShell.tsx:213 padding calc). The two chrome
  //     controls (left toggle + right terminal) are visually
  //     mirrored pairs across the window, with the same gap token
  //     on each side so the eye reads them as paired at standard
  //     zoom and scales uniformly when zoom changes.
  //   - side panel CLOSED: side-chat toggle is at right=chrome-gap;
  //     park terminal toggle to its left with chrome-gap between them:
  //     right = chrome-gap + chrome-size + chrome-gap.
  //
  // These are all RENDERER px (no /zoom division). The terminal
  // button is `size-6` (24 CSS px, also renderer-px), and the rail
  // is at fixed renderer-px width — so the gap to the rail should
  // scale with the button at the same rate to preserve the
  // proportion. (Codex's mockup chrome bar has the same property:
  // icons and gaps scale together at any size.) The earlier /zoom
  // form was correct for chrome elements that have a fixed device-px
  // size (trafficLight, OS chrome) but wrong for layout distances
  // between renderer-px elements.
  const rightOffset = hasRightPanel
    ? rightCollapsed
      ? "calc(var(--chrome-gap) + var(--chrome-size) + var(--chrome-gap))"
      : "calc(var(--right-rail-w) + var(--stage-inset) + var(--chrome-gap))"
    : "var(--chrome-gap)";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Open terminal" : "Close terminal"}
      title={collapsed ? "Open terminal" : "Close terminal"}
      className={cn(
        "app-no-drag fixed inline-flex size-6 items-center justify-center rounded-md z-50",
        "text-fg-subtle hover:bg-bg-surface hover:text-fg",
        "transition-colors",
      )}
      style={{
        right: rightOffset,
        top: "var(--chrome-top)",
        transition: "right 280ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Square terminal — matches lucide SquareTerminalIcon used on
            the bottom-panel tab chips, so the toggle and the chip
            read as the same family. */}
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <polyline points="5,7 7.5,9 5,11" />
        <line x1="9.5" y1="11" x2="11.5" y2="11" />
      </svg>
    </button>
  );
}

const BOTTOM_HEIGHT_KEY = "openma:bottom-panel-h";
const BOTTOM_MIN = 80;
const BOTTOM_MAX = 600;

/** Persisted resizable height for the bottom panel. Reads/writes
 *  localStorage so the user's drag survives reload. Clamps in case
 *  the saved value is from a previous window with a different max. */
function useBottomPanelHeight(): [number, (next: number) => void] {
  const [h, setH] = React.useState<number>(() => {
    try {
      const v = localStorage.getItem(BOTTOM_HEIGHT_KEY);
      if (v != null) {
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) return clamp(n, BOTTOM_MIN, BOTTOM_MAX);
      }
    } catch {
      /* private mode — fall through to default */
    }
    return 160;
  });
  const set = React.useCallback((next: number) => {
    const clamped = clamp(next, BOTTOM_MIN, BOTTOM_MAX);
    setH(clamped);
    try {
      localStorage.setItem(BOTTOM_HEIGHT_KEY, String(clamped));
    } catch {
      /* private mode — non-fatal */
    }
  }, []);
  return [h, set];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Top-edge drag handle for the bottom panel. 6 px hit zone, invisible
 *  by default, faint accent on hover. Uses pointer events so it works
 *  on touchscreens too, and `setPointerCapture` so a drag that leaves
 *  the handle's hit zone still gets routed back here.
 *
 *  Math: pointer Y in viewport coords; the panel's bottom edge is at
 *  the viewport's `innerHeight - stage-inset`, so the panel's effective
 *  height is `innerHeight - stage-inset - pointerY`. We compute that
 *  directly each move event — no need to track a starting offset.
 *  (The panel's `bottom` is `var(--stage-inset)` = 6 px in CSS; we
 *  resolve it once at drag start so the math doesn't depend on a CSS
 *  read every frame.) */
function BottomPanelResizer({
  onResize,
  onResizingChange,
}: {
  onResize: (next: number) => void;
  onResizingChange: (resizing: boolean) => void;
}) {
  const draggingRef = React.useRef(false);
  const stageInsetRef = React.useRef(6);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    onResizingChange(true);
    // Resolve --stage-inset once so the per-move math is a single
    // arithmetic op. Falls back to 6 if the var isn't a px literal.
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--stage-inset")
      .trim();
    const px = parseFloat(raw);
    stageInsetRef.current = Number.isFinite(px) ? px : 6;
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "ns-resize";
    // Suppress text selection during drag — Chromium will otherwise
    // highlight the page contents under the moving cursor.
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const viewportH = window.innerHeight;
    const next = viewportH - stageInsetRef.current - e.clientY;
    onResize(next);
  };

  const stopDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onResizingChange(false);
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      // Sits on the panel's top edge, 6 px tall hit zone for forgiving
      // grab. Centered visual line shows only on hover. Z above the
      // tab bar so clicks reach the handle, not the chip beneath.
      className={cn(
        "absolute left-0 right-0 top-0 z-10",
        "cursor-ns-resize group/resizer",
      )}
      style={{ height: "6px" }}
      aria-label="Resize terminal panel"
      role="separator"
      aria-orientation="horizontal"
    >
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full",
          "bg-border-strong opacity-0 group-hover/resizer:opacity-100 transition-opacity",
        )}
      />
    </div>
  );
}

function RailResizer({
  side,
  width,
  onResize,
  onResizingChange,
}: {
  side: "left" | "right";
  width: number;
  onResize: (width: number) => void;
  onResizingChange: (resizing: boolean) => void;
}) {
  const startX = React.useRef(0);
  const startWidth = React.useRef(width);
  const dragging = React.useRef(false);

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    startX.current = event.clientX;
    startWidth.current = width;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onResizingChange(true);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = side === "right"
      ? event.clientX - startX.current
      : startX.current - event.clientX;
    onResize(Math.max(MIN_RAIL_W, Math.min(MAX_RAIL_W, startWidth.current + delta)));
  };
  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onResizingChange(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      role="separator"
      aria-label={side === "right" ? "Resize sidebar" : "Resize side panel"}
      aria-orientation="vertical"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className={cn(
        "absolute inset-y-2 z-30 w-2 cursor-ew-resize group/rail-resizer",
        side === "right" ? "-right-1" : "-left-1",
      )}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-border-strong opacity-0 transition-opacity group-hover/rail-resizer:opacity-70" />
    </div>
  );
}
