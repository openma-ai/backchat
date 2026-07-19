import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  BarChart3Icon,
  Maximize2Icon,
  Minimize2Icon,
  PanelRightIcon,
  PictureInPicture2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sessionStore } from "@/lib/session-store";
import {
  MCP_APP_DISPLAY_MODES,
  resolvePipDockAction,
  type McpAppDisplayMode,
} from "@/lib/mcp-app-display";
import {
  constrainPipRect,
  createInitialPipRect,
  movePipRect,
  resizePipRect,
  type PipRect,
  type PipResizeEdge,
} from "@/lib/pip-window";
import { useI18n } from "@/lib/i18n";

const pipRectCache = new Map<string, PipRect>();

const PIP_RESIZE_HANDLES: ReadonlyArray<{
  edge: PipResizeEdge;
  className: string;
}> = [
  { edge: "north", className: "top-0 left-3 right-3 h-2 cursor-ns-resize" },
  { edge: "north-east", className: "right-0 top-0 size-3 cursor-nesw-resize" },
  { edge: "east", className: "right-0 bottom-3 top-3 w-2 cursor-ew-resize" },
  { edge: "south-east", className: "bottom-0 right-0 size-3 cursor-nwse-resize" },
  { edge: "south", className: "bottom-0 left-3 right-3 h-2 cursor-ns-resize" },
  { edge: "south-west", className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
  { edge: "west", className: "left-0 bottom-3 top-3 w-2 cursor-ew-resize" },
  { edge: "north-west", className: "left-0 top-0 size-3 cursor-nwse-resize" },
];

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function movePortalHost(target: HTMLElement, portalHost: HTMLElement): void {
  if (portalHost.parentElement === target) return;
  const atomicTarget = target as HTMLElement & {
    moveBefore?: (node: Node, child: Node | null) => void;
  };
  if (portalHost.isConnected && target.isConnected && atomicTarget.moveBefore) {
    atomicTarget.moveBefore(portalHost, null);
  } else {
    target.append(portalHost);
  }
}

export function InteractiveFrameSurface({
  surfaceId,
  sessionId,
  label,
  displayMode,
  onDisplayModeChange,
  availableDisplayModes = MCP_APP_DISPLAY_MODES,
  frameChrome = "default",
  onContainerSizeChange,
  onDismiss,
  children,
}: {
  surfaceId: string;
  sessionId: string;
  label: string;
  displayMode: McpAppDisplayMode;
  onDisplayModeChange: (mode: McpAppDisplayMode) => void;
  availableDisplayModes?: readonly McpAppDisplayMode[];
  frameChrome?: "default" | "none";
  onContainerSizeChange?: (dimensions: { width: number; height: number }) => void;
  onDismiss?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [sideHost, setSideHost] = useState<HTMLElement | null>(null);
  const [inlineHost, setInlineHost] = useState<HTMLElement | null>(null);
  const [portalHost] = useState(() => {
    const host = document.createElement("div");
    host.style.display = "contents";
    host.dataset.interactivePortal = surfaceId;
    return host;
  });
  const [shellElement, setShellElement] = useState<HTMLElement | null>(null);
  const [pipDocked, setPipDocked] = useState(false);
  const pipCacheKey = `${sessionId}:${surfaceId}`;
  const [pipRect, setPipRect] = useState<PipRect>(() =>
    pipRectCache.get(pipCacheKey) ?? createInitialPipRect(viewportSize()));
  const pipRectRef = useRef(pipRect);
  pipRectRef.current = pipRect;
  const [isManipulatingPip, setIsManipulatingPip] = useState(false);
  const interactionCleanupRef = useRef<(() => void) | null>(null);
  const isDockedPip = displayMode === "pip" && pipDocked;
  const isFloatingPip = displayMode === "pip" && !pipDocked;
  const containerMode = isDockedPip ? "fullscreen" : displayMode;
  const showFrameChrome = frameChrome === "default";

  useEffect(() => {
    pipRectCache.set(pipCacheKey, pipRect);
    if (pipRectCache.size > 64) {
      const oldestKey = pipRectCache.keys().next().value;
      if (oldestKey) pipRectCache.delete(oldestKey);
    }
  }, [pipCacheKey, pipRect]);

  useEffect(() => {
    if (!shellElement || !onContainerSizeChange) return;
    const reportSize = () => {
      const bounds = shellElement.getBoundingClientRect();
      onContainerSizeChange({
        width: Math.round(bounds.width),
        height: Math.max(0, Math.round(bounds.height) - 36),
      });
    };
    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(shellElement);
    return () => observer.disconnect();
  }, [onContainerSizeChange, shellElement]);

  useEffect(() => {
    if (displayMode !== "pip") setPipDocked(false);
  }, [displayMode]);

  const dockPip = useCallback(() => {
    if (resolvePipDockAction(availableDisplayModes) === "fullscreen") {
      onDisplayModeChange("fullscreen");
    } else {
      setPipDocked(true);
    }
  }, [availableDisplayModes, onDisplayModeChange]);

  useEffect(() => {
    const onResize = () => setPipRect((current) => constrainPipRect(current, viewportSize()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => () => interactionCleanupRef.current?.(), []);

  useEffect(() => () => portalHost.remove(), [portalHost]);

  const startPipInteraction = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    kind: "move" | PipResizeEdge,
  ) => {
    if (!isFloatingPip || event.button !== 0) return;
    if (kind === "move" && (event.target as Element).closest("button")) return;
    event.preventDefault();
    interactionCleanupRef.current?.();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = pipRectRef.current;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    setIsManipulatingPip(true);
    try { target.setPointerCapture(pointerId); } catch { /* pointer capture is best-effort */ }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const nextRect = kind === "move"
        ? movePipRect(startRect, deltaX, deltaY, viewportSize())
        : resizePipRect(startRect, kind, deltaX, deltaY, viewportSize());
      pipRectRef.current = nextRect;
      setPipRect(nextRect);
    };
    const finish = (finishEvent?: PointerEvent) => {
      if (finishEvent && finishEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
      target.removeEventListener("lostpointercapture", finish);
      document.body.style.userSelect = previousUserSelect;
      setIsManipulatingPip(false);
      try { target.releasePointerCapture(pointerId); } catch { /* already released */ }
      if (interactionCleanupRef.current === cleanup) interactionCleanupRef.current = null;
    };
    const cleanup = () => finish();
    interactionCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
    target.addEventListener("lostpointercapture", finish);
  }, [isFloatingPip]);

  useEffect(() => {
    if (displayMode === "inline") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (displayMode === "pip") {
        if (isDockedPip) setPipDocked(false);
        else dockPip();
        return;
      }
      onDisplayModeChange("inline");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayMode, dockPip, isDockedPip, onDisplayModeChange]);

  useEffect(() => {
    const tabId = `interactive-${surfaceId}`;
    if (containerMode !== "fullscreen") {
      setSideHost(null);
      return;
    }
    sessionStore.openSideTabForTask(
      sessionId,
      "interactive",
      surfaceId,
      label,
      tabId,
    );
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setSideHost(document.getElementById(`interactive-side-host-${surfaceId}`));
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      sessionStore.closeSideTabForTask(sessionId, tabId);
      setSideHost(null);
    };
  }, [containerMode, label, sessionId, surfaceId]);

  useLayoutEffect(() => {
    const target = isFloatingPip
      ? document.body
      : containerMode === "fullscreen"
        ? sideHost
        : inlineHost;
    if (target) movePortalHost(target, portalHost);
  }, [containerMode, inlineHost, isFloatingPip, portalHost, sideHost]);

  const pipStyle: CSSProperties | undefined = isFloatingPip ? {
    width: pipRect.width,
    height: pipRect.height,
    transform: `translate3d(${pipRect.x}px, ${pipRect.y}px, 0)`,
  } : undefined;

  const shell = (
    <section
      ref={setShellElement}
      className={cn(
        showFrameChrome ? "overflow-hidden bg-bg-surface" : "w-full bg-transparent",
        containerMode === "inline" && showFrameChrome && "mt-2 rounded-xl",
        containerMode === "fullscreen" && "h-full min-h-0",
        isFloatingPip && [
          "group/pip fixed left-0 top-0 z-40 flex flex-col rounded-xl shadow-pip",
          "will-change-transform motion-reduce:transition-none",
          isManipulatingPip && "select-none",
        ],
      )}
      style={pipStyle}
      aria-label={label}
      data-pip-window={isFloatingPip ? "true" : undefined}
      data-pip-docked={isDockedPip ? "true" : undefined}
      data-pip-manipulating={isFloatingPip ? String(isManipulatingPip) : undefined}
    >
      {showFrameChrome && <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-1.5 px-3 text-[11px] text-fg-muted",
          isFloatingPip && "touch-none cursor-grab bg-bg/55 active:cursor-grabbing",
        )}
        data-pip-drag-handle={isFloatingPip ? "true" : undefined}
        onPointerDown={isFloatingPip ? (event) => startPipInteraction(event, "move") : undefined}
      >
        {displayMode === "pip"
          ? <PictureInPicture2Icon className="size-3.5" />
          : <BarChart3Icon className="size-3.5" />}
        <span className="min-w-0 truncate">{label}</span>
        {displayMode === "pip" ? (
          <div className="ml-auto flex items-center gap-0.5" role="group" aria-label={t("mcpApp.displayMode")}>
            {isDockedPip ? (
              <button
                type="button"
                onClick={() => setPipDocked(false)}
                className="grid size-7 place-items-center rounded-md transition-colors hover:bg-bg-bubble/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                aria-label={t("mcpApp.pip.popout")}
              >
                <PictureInPicture2Icon className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={dockPip}
                className="grid size-7 place-items-center rounded-md transition-colors hover:bg-bg-bubble/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                aria-label={t("mcpApp.pip.restore")}
              >
                <PanelRightIcon className="size-3.5" />
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={() => { void onDismiss(); }}
                className="grid size-7 place-items-center rounded-md transition-colors hover:bg-bg-bubble/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                aria-label={t("mcpApp.pip.close")}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        ) : availableDisplayModes.length > 1 && (
        <div className="ml-auto flex items-center gap-0.5" role="group" aria-label={t("mcpApp.displayMode")}>
          {availableDisplayModes.map((mode) => {
            const Icon = mode === "inline"
              ? Minimize2Icon
              : mode === "fullscreen"
                ? Maximize2Icon
                : PictureInPicture2Icon;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onDisplayModeChange(mode)}
                className={cn(
                  "grid size-7 place-items-center rounded-md transition-colors hover:bg-bg-bubble/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                  displayMode === mode && "bg-bg-bubble text-fg",
                )}
                aria-label={t(`mcpApp.mode.${mode}`)}
                aria-pressed={displayMode === mode}
              >
                <Icon className="size-3.5" />
              </button>
            );
          })}
        </div>
        )}
      </div>}
      <div className={cn(displayMode === "pip" && "min-h-0 flex-1 overflow-hidden")}>
        {children}
      </div>
      {isFloatingPip && PIP_RESIZE_HANDLES.map(({ edge, className }) => (
        <div
          key={edge}
          className={cn("absolute z-10 touch-none", className)}
          data-pip-resize={edge}
          aria-hidden="true"
          onPointerDown={(event) => startPipInteraction(event, edge)}
        />
      ))}
    </section>
  );

  return (
    <>
      <div ref={setInlineHost} className="contents" />
      {createPortal(shell, portalHost)}
    </>
  );
}
