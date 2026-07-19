import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Code2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  MessageCirclePlusIcon,
  RotateCwIcon,
  SearchIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  BrowserElementHoverInfo,
  BrowserElementPickResult,
  BrowserRegionPickResult,
} from "@shared/browser-element-picker.js";
import type { PromptAnnotation } from "@shared/session-events.js";
import { shouldAttachBrowserAnnotationScreenshot } from "@shared/browser-settings.js";
import { cn } from "@/lib/utils";
import {
  browserAnnotationGesture,
  browserAnnotationMarkers,
  buildBrowserElementPromptAnnotation,
  buildBrowserRegionPromptAnnotation,
  browserElementScreenshotName,
  browserStyleChanges,
  browserStyleDraft,
  browserRegionScreenshotName,
  type BrowserStyleDraft,
  type BrowserStyleProperty,
} from "@/lib/browser-element-annotation";
import { composerInsertionStore } from "@/lib/composer-insertions";
import {
  browserAddressLabel,
  normalizeBrowserUrl,
} from "@/lib/browser-url";
import {
  applyBrowserFindQuery,
  bindBrowserFindShortcuts,
  clearBrowserFind,
  findNextInBrowser,
} from "@/lib/browser-find";
import { BrowserPickerController } from "@/lib/browser-picker-controller";
import { BrowserResizeSnapshotController } from "@/lib/browser-resize-snapshot-controller";
import { bindBrowserViewRegistration } from "@/lib/browser-view-registration";
import { bindBrowserWebviewEvents } from "@/lib/browser-webview-events";
import {
  promptAnnotationStore,
  usePromptAnnotations,
} from "@/lib/prompt-annotations";
import {
  AnnotationBadge,
  AnnotationEditor,
} from "../chat/AnnotationEditor";
import {
  BrowserDataDialog,
  type BrowserDataPanel,
} from "@/components/shell/BrowserDataDialog";
import { BrowserMenu } from "@/components/shell/BrowserMenu";
import { FileOpenMenu } from "@/components/shell/FileOpenMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/lib/settings-store";
import type {
  BrowserClearDataKind,
  BrowserCredentialSummary,
  BrowserDownloadInfo,
} from "@shared/browser-data.js";

type BrowserWebviewElement = HTMLElement & {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
  getURL(): string;
  getWebContentsId(): number;
  findInPage(
    text: string,
    options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
  ): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  openDevTools(): void;
  print(): Promise<void>;
  clearHistory(): void;
  executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
  capturePage(): Promise<{ toDataURL(): string }>;
};

type BrowserPoint = { x: number; y: number };

type BrowserRegionDrag = {
  start: BrowserPoint;
  current: BrowserPoint;
};

const RESIZE_SNAPSHOT_SETTLE_MS = 180;

function localPathFromFileUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "file:") return undefined;
    let path = decodeURIComponent(url.pathname);
    if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    return path || undefined;
  } catch {
    return undefined;
  }
}

function localFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function localFileExtension(path: string): string {
  const name = localFileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "FILE";
}

/**
 * BrowserTab — Electron `<webview>` with a minimal URL bar +
 * back / forward / reload. webviewTag must be true in the main
 * window's webPreferences (see src/main/index.ts).
 *
 * v1 limits:
 *   - no devtools toggle, no zoom, no profile / cookie isolation
 *   - history persistence is in-component only (one back stack, one
 *     forward stack via webview's can-go-back / can-go-forward)
 *   - URL bar accepts http(s) only; bare strings ("google") are
 *     treated as a Google search (matches Chrome's omnibox).
 *
 * The `currentUrl` is mirrored back to the parent via `onUrlChange`
 * so the tab chip's label can update to the page's hostname.
 */
export function BrowserTab({
  sessionId,
  tabId,
  active,
  visible,
  initialUrl,
  sourcePath,
  onUrlChange,
  onPageMeta,
}: {
  sessionId: string | null;
  tabId: string;
  active: boolean;
  visible: boolean;
  initialUrl: string;
  sourcePath?: string;
  onUrlChange?: (url: string) => void;
  onPageMeta?: (meta: { title?: string; faviconUrl?: string }) => void;
}) {
  const navigate = useNavigate();
  const localSourcePath = sourcePath ?? localPathFromFileUrl(initialUrl);
  // Electron's <webview> tag exposes a custom DOM interface (goBack,
  // canGoBack, src setter, etc.). Typing it as a structural any-shape
  // avoids pulling in Electron's renderer types (which aren't loaded
  // by tsconfig.web.json by default).
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const registeredWebContentsIdRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onUrlChangeRef = useRef(onUrlChange);
  const onPageMetaRef = useRef(onPageMeta);
  onUrlChangeRef.current = onUrlChange;
  onPageMetaRef.current = onPageMeta;
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [urlFocused, setUrlFocused] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(() => normalizeBrowserUrl(initialUrl));
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [zoomFactor, setZoomFactor] = useState(1);
  const [browserPanel, setBrowserPanel] = useState<BrowserDataPanel>(null);
  const [downloads, setDownloads] = useState<BrowserDownloadInfo[]>([]);
  const [credentials, setCredentials] = useState<BrowserCredentialSummary[]>([]);
  const [clearKinds, setClearKinds] = useState<BrowserClearDataKind[]>([
    "history",
    "cookies",
    "cache",
  ]);
  const [isPickingElement, setIsPickingElement] = useState(false);
  const [pickerHover, setPickerHover] = useState<BrowserElementHoverInfo | null>(null);
  const [regionDrag, setRegionDrag] = useState<BrowserRegionDrag | null>(null);
  const [resizeSnapshot, setResizeSnapshot] = useState<string | null>(null);
  const cachedSnapshotRef = useRef<string | null>(null);
  const regionDragRef = useRef<BrowserRegionDrag | null>(null);
  const browserViewportRef = useRef<HTMLDivElement | null>(null);
  const browserAnnotationEditorRef = useRef<HTMLDivElement | null>(null);
  const cancelPickerRef = useRef<() => Promise<void>>(async () => undefined);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const settings = useSettings();
  const annotations = usePromptAnnotations(sessionId);
  const pageAnnotationMarkers = useMemo(
    () => browserAnnotationMarkers(annotations, currentUrl),
    [annotations, currentUrl],
  );
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const editingMarker = editingAnnotationId
    ? pageAnnotationMarkers.find((marker) => marker.annotation.id === editingAnnotationId) ?? null
    : null;
  const [editingStyleDraft, setEditingStyleDraft] = useState<BrowserStyleDraft | null>(null);

  useEffect(() => {
    const browser = editingMarker?.annotation.browser;
    setEditingStyleDraft(browser ? browserStyleDraft(browser) : null);
  }, [editingMarker?.annotation.id]);

  useEffect(() => {
    if (!sessionId) return;
    const webview = webviewRef.current;
    if (!webview) return;
    return bindBrowserViewRegistration(webview, {
      sessionId,
      tabId,
      getActive: () => activeRef.current,
      register: (input) => window.backchat.browserViewRegister(input),
      unregister: (input) => window.backchat.browserViewUnregister(input),
      setActive: (input) => window.backchat.browserViewSetActive(input),
      onRegistered: (webContentsId) => {
        registeredWebContentsIdRef.current = webContentsId;
      },
    });
  }, [sessionId, tabId]);

  useEffect(() => {
    if (!active || !sessionId) return;
    const webContentsId = registeredWebContentsIdRef.current;
    if (webContentsId === null) return;
    void window.backchat.browserViewSetActive({
      sessionId,
      tabId,
      webContentsId,
    }).catch(() => undefined);
  }, [active, sessionId, tabId]);

  const captureDataUrl = useCallback(async (): Promise<string | null> => {
    const webview = webviewRef.current;
    if (!webview) return null;
    try {
      const image = await webview.capturePage();
      const dataUrl = image.toDataURL();
      return dataUrl.startsWith("data:image/png;base64,") ? dataUrl : null;
    } catch {
      return null;
    }
  }, []);

  const navigateTo = useCallback(
    (raw: string) => {
      const wv = webviewRef.current;
      if (!wv) return;
      const url = normalizeBrowserUrl(raw);
      setUrlInput(url);
      void wv.loadURL(url).catch(() => {
        // Keep a small fallback for test doubles and older Electron webviews.
        wv.src = url;
      });
    },
    [],
  );

  const canOpenExternal = /^https?:\/\//i.test(currentUrl);
  const openExternal = useCallback(() => {
    if (!/^https?:\/\//i.test(currentUrl)) return;
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  }, [currentUrl]);

  const copyAddress = useCallback(() => {
    if (!currentUrl) return;
    void navigator.clipboard.writeText(currentUrl).then(
      () => toast.success("Address copied"),
      () => toast.error("Could not copy the address"),
    );
  }, [currentUrl]);

  const openLocalFile = useCallback(() => {
    if (!localSourcePath) return;
    void window.backchat.uiFsOpenPath({ path: localSourcePath }).then((error) => {
      if (error) {
        toast.error("Couldn't open file", { description: error });
      }
    });
  }, [localSourcePath]);

  const revealLocalFile = useCallback(() => {
    if (!localSourcePath) return;
    void window.backchat.uiFsRevealPath({ path: localSourcePath });
  }, [localSourcePath]);

  const changeZoom = useCallback((delta: number) => {
    const webview = webviewRef.current;
    if (!webview) return;
    const current = webview.getZoomFactor();
    const next = Math.min(2, Math.max(0.5, Math.round((current + delta) * 10) / 10));
    webview.setZoomFactor(next);
    setZoomFactor(next);
  }, []);

  const resetZoom = useCallback(() => {
    webviewRef.current?.setZoomFactor(1);
    setZoomFactor(1);
  }, []);

  const browserWebContentsId = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) throw new Error("Browser tab is not ready");
    return webview.getWebContentsId();
  }, []);

  const captureScreenshot = useCallback(async () => {
    try {
      const result = await window.backchat.browserCaptureScreenshot({
        webContentsId: browserWebContentsId(),
      });
      toast.success("Screenshot saved", { description: result.path });
    } catch (error) {
      toast.error("Could not capture screenshot", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [browserWebContentsId]);

  const printPage = useCallback(async () => {
    try {
      await webviewRef.current?.print();
    } catch (error) {
      toast.error("Could not print page", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const showDeviceToolbar = useCallback(async () => {
    try {
      await window.backchat.browserShowDeviceToolbar({
        webContentsId: browserWebContentsId(),
      });
    } catch (error) {
      toast.error("Could not open device toolbar", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [browserWebContentsId]);

  const loadDownloads = useCallback(async () => {
    try {
      setDownloads(await window.backchat.browserDownloadsList({
        webContentsId: browserWebContentsId(),
      }));
    } catch {
      setDownloads([]);
    }
  }, [browserWebContentsId]);

  const loadCredentials = useCallback(async () => {
    try {
      setCredentials(await window.backchat.browserCredentialsList({
        webContentsId: browserWebContentsId(),
      }));
    } catch {
      setCredentials([]);
    }
  }, [browserWebContentsId]);

  const clearBrowsingData = useCallback(async () => {
    try {
      await window.backchat.browserClearData({
        webContentsId: browserWebContentsId(),
        kinds: clearKinds,
      });
      toast.success("Browsing data cleared");
      setBrowserPanel(null);
    } catch (error) {
      toast.error("Could not clear browsing data", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [browserWebContentsId, clearKinds]);

  useEffect(() => {
    if (browserPanel !== "downloads") return;
    void loadDownloads();
    return window.backchat.onBrowserDownloadsChanged(() => void loadDownloads());
  }, [browserPanel, loadDownloads]);

  useEffect(() => {
    if (browserPanel !== "passwords") return;
    void loadCredentials();
  }, [browserPanel, loadCredentials]);

  useEffect(() => {
    const defaultZoom = settings?.browser?.default_zoom;
    if (!visible || !ready || typeof defaultZoom !== "number") return;
    webviewRef.current?.setZoomFactor(defaultZoom);
    setZoomFactor(defaultZoom);
  }, [ready, settings?.browser?.default_zoom, visible]);

  const openFind = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.focus());
  }, []);

  const closeFind = useCallback(() => {
    clearBrowserFind(webviewRef.current);
    setFindOpen(false);
    setFindQuery("");
  }, []);

  useEffect(() => {
    if (!visible) return;
    return bindBrowserFindShortcuts(window, {
      isOpen: () => findOpen,
      onOpen: openFind,
      onClose: closeFind,
    });
  }, [closeFind, findOpen, openFind, visible]);

  useEffect(() => {
    if (!findOpen) return;
    applyBrowserFindQuery(webviewRef.current, findQuery);
  }, [findOpen, findQuery]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const cacheCurrentFrame = () => {
      void captureDataUrl().then((dataUrl) => {
        if (dataUrl) cachedSnapshotRef.current = dataUrl;
      });
    };
    return bindBrowserWebviewEvents(wv, {
      onNavigation: ({ canBack: nextCanBack, canForward, url }) => {
        setCanBack(nextCanBack);
        setCanFwd(canForward);
        setUrlInput(url);
        setCurrentUrl(url);
        onUrlChangeRef.current?.(url);
      },
      onPageMeta: (meta) => onPageMetaRef.current?.(meta),
      onDomReady: ({ url, zoomFactor: nextZoomFactor }) => {
        setCurrentUrl(url);
        setZoomFactor(nextZoomFactor);
        setReady(true);
      },
      onMainFrameNavigationStart: () => {
        void cancelPickerRef.current();
        setLoading(true);
        setReady(false);
      },
      onLoadStop: () => {
        setLoading(false);
        setReady(true);
      },
      onCacheFrame: cacheCurrentFrame,
    });
  }, [captureDataUrl]);

  useEffect(() => {
    if (!visible) {
      setResizeSnapshot(null);
      return;
    }
    const controller = new BrowserResizeSnapshotController({
      settleMs: RESIZE_SNAPSHOT_SETTLE_MS,
      capture: captureDataUrl,
      getCachedSnapshot: () => cachedSnapshotRef.current,
      onCacheSnapshot: (dataUrl) => {
        cachedSnapshotRef.current = dataUrl;
      },
      cancelPicker: () => {
        void cancelPickerRef.current();
      },
      onSnapshot: setResizeSnapshot,
      scheduleTimeout: (callback, delay) => window.setTimeout(callback, delay),
      cancelTimeout: (timerId) => window.clearTimeout(timerId),
    });
    const onResize = () => controller.resize();

    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      controller.dispose();
    };
  }, [captureDataUrl, visible]);

  useEffect(() => {
    if (editingAnnotationId && !editingMarker) setEditingAnnotationId(null);
  }, [editingAnnotationId, editingMarker]);

  useEffect(() => {
    if (!editingAnnotationId) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (browserAnnotationEditorRef.current?.contains(target)) return;
      if (target.closest("[data-browser-annotation-marker-button]")) return;
      setEditingAnnotationId(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [editingAnnotationId]);

  const addElementResult = useCallback(async (
    destinationSessionId: string,
    result: BrowserElementPickResult,
  ) => {
    const includeScreenshot = shouldAttachBrowserAnnotationScreenshot(settings?.browser);
    const attachment = includeScreenshot
      ? await window.backchat.uiFsSaveCapture({
        data: result.screenshotData,
        name: browserElementScreenshotName(result.element),
        mimeType: "image/png",
      })
      : null;
    const annotationId = globalThis.crypto?.randomUUID?.()
      ?? `browser-annotation-${Date.now()}`;
    const annotation = buildBrowserElementPromptAnnotation({
      id: annotationId,
      sessionId: destinationSessionId,
      element: result.element,
      screenshotName: attachment?.name ?? "",
    });
    promptAnnotationStore.add(destinationSessionId, annotation);
    if (attachment) {
      composerInsertionStore.add(destinationSessionId, {
        id: annotationId,
        attachments: [attachment],
      });
    }
    toast.success("Page element added to prompt", {
      description: result.element.selector,
    });
    return annotation;
  }, [settings?.browser]);

  const addRegionResult = useCallback(async (
    destinationSessionId: string,
    result: BrowserRegionPickResult,
  ) => {
    const includeScreenshot = shouldAttachBrowserAnnotationScreenshot(settings?.browser);
    const attachment = includeScreenshot
      ? await window.backchat.uiFsSaveCapture({
        data: result.screenshotData,
        name: browserRegionScreenshotName(),
        mimeType: "image/png",
      })
      : null;
    const annotationId = globalThis.crypto?.randomUUID?.()
      ?? `browser-region-${Date.now()}`;
    const annotation = buildBrowserRegionPromptAnnotation({
      id: annotationId,
      sessionId: destinationSessionId,
      region: result.region,
      screenshotName: attachment?.name ?? "",
    });
    promptAnnotationStore.add(destinationSessionId, annotation);
    if (attachment) {
      composerInsertionStore.add(destinationSessionId, {
        id: annotationId,
        attachments: [attachment],
      });
    }
    toast.success("Page region added to prompt", {
      description: annotation.text,
    });
    return annotation;
  }, [settings?.browser]);

  const refreshSnapshot = useCallback(() => {
    void captureDataUrl().then((dataUrl) => {
      if (dataUrl) cachedSnapshotRef.current = dataUrl;
    });
  }, [captureDataUrl]);

  const pickerRuntimeRef = useRef({
    visible,
    sessionId,
    addElementResult,
    addRegionResult,
    refreshSnapshot,
  });
  pickerRuntimeRef.current = {
    visible,
    sessionId,
    addElementResult,
    addRegionResult,
    refreshSnapshot,
  };
  const pickerControllerRef = useRef<BrowserPickerController | null>(null);
  if (!pickerControllerRef.current) {
    pickerControllerRef.current = new BrowserPickerController({
      api: {
        begin: (input) => window.backchat.browserElementPickerBegin(input),
        cancel: (input) => window.backchat.browserElementPickerCancel(input),
        hover: (input) => window.backchat.browserElementPickerHover(input),
        commit: (input) => window.backchat.browserElementPickerCommit(input),
        captureRegion: (input) =>
          window.backchat.browserElementPickerCaptureRegion(input),
      },
      getTarget: () => {
        const runtime = pickerRuntimeRef.current;
        const webview = webviewRef.current;
        if (!runtime.visible || !runtime.sessionId || !webview) return null;
        return {
          webContentsId: webview.getWebContentsId(),
          sessionId: runtime.sessionId,
        };
      },
      scheduleFrame: (callback) => requestAnimationFrame(() => callback()),
      cancelFrame: (frameId) => cancelAnimationFrame(frameId),
      onPickingChange: (active) => {
        regionDragRef.current = null;
        setRegionDrag(null);
        setIsPickingElement(active);
      },
      onHover: setPickerHover,
      onElementResult: async (destinationSessionId, result) => {
        await pickerRuntimeRef.current.addElementResult(destinationSessionId, result);
      },
      onRegionResult: async (destinationSessionId, result) => {
        await pickerRuntimeRef.current.addRegionResult(destinationSessionId, result);
      },
      onRefreshSnapshot: () => pickerRuntimeRef.current.refreshSnapshot(),
      onError: (stage, error) => {
        const title = stage === "begin"
          ? "Couldn't start page annotation"
          : stage === "element"
            ? "Couldn't annotate this page"
            : "Couldn't capture this page region";
        toast.error(title, {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }
  const pickerController = pickerControllerRef.current;
  const cancelElementPicker = useCallback(
    () => pickerController.cancel(),
    [pickerController],
  );
  cancelPickerRef.current = cancelElementPicker;

  useEffect(() => () => {
    void pickerController.dispose();
  }, [pickerController]);

  useEffect(() => {
    if (isPickingElement && !visible) {
      void cancelElementPicker();
    }
  }, [cancelElementPicker, isPickingElement, visible]);

  useEffect(() => {
    if (!isPickingElement) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void cancelElementPicker();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelElementPicker, isPickingElement]);

  const annotatePageElement = useCallback(async () => {
    if (pickerController.isPicking()) {
      await pickerController.cancel();
      return;
    }
    await pickerController.begin();
  }, [pickerController]);

  const editBrowserAnnotation = useCallback((annotationId: string) => {
    setEditingAnnotationId(annotationId);
  }, []);

  const pointerPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>): BrowserPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }, []);

  const onPickerPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointerPoint(event);
    const drag = regionDragRef.current;
    if (drag) {
      const next = { ...drag, current: point };
      regionDragRef.current = next;
      setRegionDrag(next);
      return;
    }
    pickerController.requestHover(point);
  }, [pickerController, pointerPoint]);

  const onPickerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pickerController.isBusy()) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPoint(event);
    const drag = { start: point, current: point };
    regionDragRef.current = drag;
    setRegionDrag(drag);
  }, [pickerController, pointerPoint]);

  const onPickerPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = regionDragRef.current;
    if (!drag || event.button !== 0 || pickerController.isBusy()) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const end = pointerPoint(event);
    regionDragRef.current = null;
    setRegionDrag(null);
    const gesture = browserAnnotationGesture(drag.start, end);
    if (gesture.kind === "region") {
      void pickerController.captureRegion(gesture.rect);
    } else {
      void pickerController.commit(end);
    }
  }, [pickerController, pointerPoint]);

  const onPickerPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    regionDragRef.current = null;
    setRegionDrag(null);
  }, []);

  const regionSelection = useMemo(() => {
    if (!regionDrag) return null;
    const gesture = browserAnnotationGesture(regionDrag.start, regionDrag.current);
    return gesture.kind === "region" ? gesture.rect : null;
  }, [regionDrag]);
  const editingAnnotationRect = (() => {
    const bounds = browserViewportRef.current?.getBoundingClientRect();
    if (!bounds || !editingMarker) return null;
    const rect = editingMarker.rect;
    return {
      top: bounds.top + rect.y,
      right: bounds.left + rect.x + rect.width,
      bottom: bounds.top + rect.y + rect.height,
      left: bounds.left + rect.x,
      width: rect.width,
      height: rect.height,
    };
  })();
  const showingBlankPage = currentUrl === "about:blank";

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-browser-task={sessionId ?? "home"}
      data-browser-tab={tabId}
      data-browser-active={active ? "true" : "false"}
      data-browser-visible={visible ? "true" : "false"}
    >
      {/* A local artifact is a document surface, not a browser address bar.
          Keep preview and native file actions in the same stable title row. */}
      {localSourcePath ? (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/55 px-4">
          <FileTextIcon className="size-4 shrink-0 text-fg-muted" />
          <div className="min-w-0 flex flex-1 items-baseline gap-2">
            <span className="truncate text-xs font-medium text-fg">
              {localFileName(localSourcePath)}
            </span>
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              {localFileExtension(localSourcePath)}
            </span>
          </div>
          <FileOpenMenu
            path={localSourcePath}
            onOpenDefault={openLocalFile}
            onReveal={revealLocalFile}
          />
        </div>
      ) : (
      /* Browser chrome stays visually attached to the task tab row. */
      <div className="shrink-0 flex items-center gap-1 bg-transparent px-3 pt-1 pb-1.5">
        <NavButton
          onClick={() => webviewRef.current?.goBack()}
          disabled={!canBack}
          label="Back"
        >
          <ArrowLeftIcon className="size-3.5" />
        </NavButton>
        <NavButton
          onClick={() => webviewRef.current?.goForward()}
          disabled={!canFwd}
          label="Forward"
        >
          <ArrowRightIcon className="size-3.5" />
        </NavButton>
        <NavButton
          onClick={() => webviewRef.current?.reload()}
          disabled={loading && false}
          label="Reload"
        >
          <RotateCwIcon className={cn("size-3.5", loading && "animate-spin")} />
        </NavButton>
        <form
          className="min-w-0 flex-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(urlInput.trim());
          }}
        >
          <div className="relative">
            <input
              type="text"
              value={urlInput === "about:blank"
                ? ""
                : urlFocused
                  ? urlInput
                  : browserAddressLabel(urlInput)}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={(e) => {
                setUrlFocused(true);
                e.currentTarget.select();
              }}
              onBlur={() => setUrlFocused(false)}
              placeholder="Enter URL or search"
              className={cn(
                "h-7 w-full rounded-md border border-border/60 px-3 text-xs",
                "bg-bg-surface/75 text-fg shadow-none placeholder:text-fg-subtle",
                "transition-colors hover:bg-bg-surface/80",
                "focus:border-border-strong focus:bg-bg-surface focus:outline-none",
              )}
            />
          </div>
        </form>
        <NavButton
          onClick={openExternal}
          disabled={!canOpenExternal}
          label="Open in default browser"
        >
          <ExternalLinkIcon className="size-3.5" />
        </NavButton>
        <NavButton
          onClick={() => void annotatePageElement()}
          disabled={!ready || !visible || !sessionId}
          label={isPickingElement ? "Cancel page annotation" : "Annotate page element"}
          active={isPickingElement}
        >
          <MessageCirclePlusIcon className="size-3.5" />
        </NavButton>
        <BrowserMenu
          zoomFactor={zoomFactor}
          canOpenExternal={canOpenExternal}
          onOpenFind={openFind}
          onPrintPage={() => void printPage()}
          onChangeZoom={changeZoom}
          onResetZoom={resetZoom}
          onShowDeviceToolbar={() => void showDeviceToolbar()}
          onCaptureScreenshot={() => void captureScreenshot()}
          onReload={() => webviewRef.current?.reload()}
          onCopyAddress={copyAddress}
          onOpenExternal={openExternal}
          onOpenPanel={setBrowserPanel}
          onOpenSettings={() => void navigate({ to: "/settings/browser" })}
        />
      </div>
      )}
      <BrowserDataDialog
        panel={browserPanel}
        downloads={downloads}
        credentials={credentials}
        clearKinds={clearKinds}
        onClose={() => setBrowserPanel(null)}
        onClearKindsChange={setClearKinds}
        onFillCredential={(credentialId) => {
          void window.backchat.browserCredentialFill({
            webContentsId: browserWebContentsId(),
            credentialId,
          });
        }}
        onDeleteCredential={(credentialId) => {
          void window.backchat.browserCredentialDelete({
            webContentsId: browserWebContentsId(),
            credentialId,
          }).then(loadCredentials);
        }}
        onRevealDownload={(downloadId) => {
          void window.backchat.browserDownloadAction({
            webContentsId: browserWebContentsId(),
            downloadId,
            action: "reveal",
          });
        }}
        onClearData={() => void clearBrowsingData()}
      />
      {findOpen && (
        <form
          className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 px-3"
          onSubmit={(event) => {
            event.preventDefault();
            findNextInBrowser(webviewRef.current, findQuery);
          }}
        >
          <SearchIcon className="size-3.5 shrink-0 text-fg-subtle" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            placeholder="Find in page"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
          />
          <button
            type="button"
            onClick={closeFind}
            aria-label="Close find"
            className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-surface hover:text-fg"
          >
            <XIcon className="size-3.5" />
          </button>
        </form>
      )}
      <div ref={browserViewportRef} className="relative flex-1 min-h-0">
        {/* @ts-expect-error — Electron's <webview> isn't in React's
            default JSX type registry; the runtime accepts standard
            DOM attributes verbatim. We narrow via the structural ref
            type above. */}
        <webview
          ref={webviewRef}
          src={normalizeBrowserUrl(initialUrl || "about:blank")}
          className={cn(
            "h-full w-full bg-bg",
            (resizeSnapshot || showingBlankPage) && "invisible",
          )}
          // partition: in-memory only (no on-disk persistence). Each
          // tab uses the same partition so cookies survive tab swap
          // within one session but vanish on quit.
          partition="memory:browser"
          // allowFileAccess=yes — without this, file:// navigation
          // silently fails. Agents commonly write artifacts under
          // ~/.openma/sessions/<sid>/ and we auto-open them; the user
          // explicitly trusted the agent's output, so granting file
          // access for in-app preview matches expectation. Network/web
          // content still goes through the standard partition sandbox.
          webpreferences="allowFileAccess=yes,contextIsolation=yes"
        />
        {isPickingElement && !resizeSnapshot && (
          <div
            data-browser-annotation-overlay
            aria-label="Browser annotation canvas"
            className="absolute inset-0 z-20 cursor-crosshair touch-none"
            onPointerDown={onPickerPointerDown}
            onPointerMove={onPickerPointerMove}
            onPointerUp={onPickerPointerUp}
            onPointerCancel={onPickerPointerCancel}
            onPointerLeave={() => {
              if (!regionDragRef.current) setPickerHover(null);
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {!regionSelection && pickerHover && (
              <div
                data-browser-element-hover
                className="pointer-events-none absolute border-2 border-[#3b82f6] bg-[#3b82f6]/15"
                style={{
                  left: pickerHover.rect.x,
                  top: pickerHover.rect.y,
                  width: pickerHover.rect.width,
                  height: pickerHover.rect.height,
                }}
              >
                  <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full border-2 border-white bg-[#3b82f6] text-[10px] font-semibold leading-none text-white shadow-sm">
                  1
                </span>
                <span
                  className={cn(
                    "absolute left-0 max-w-[420px] truncate rounded-sm bg-[#2563eb] px-1.5 py-0.5",
                    "text-[10px] font-medium leading-4 text-white shadow-sm",
                    pickerHover.rect.y >= 24 ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]",
                  )}
                >
                  {pickerHover.label}
                </span>
              </div>
            )}
            {regionSelection && (
              <div
                data-browser-region-selection
                className="pointer-events-none absolute border-2 border-dashed border-[#3b82f6] bg-[#3b82f6]/15"
                style={{
                  left: regionSelection.x,
                  top: regionSelection.y,
                  width: regionSelection.width,
                  height: regionSelection.height,
                }}
              >
                <span className="absolute -bottom-2.5 -right-2.5 grid size-5 place-items-center rounded-full border-2 border-white bg-[#3b82f6] text-[10px] font-semibold leading-none text-white shadow-sm">
                  1
                </span>
              </div>
            )}
          </div>
        )}
        {pageAnnotationMarkers.length > 0 && !resizeSnapshot && (
          <div
            data-browser-annotation-markers
            className="pointer-events-none absolute inset-0 z-30"
          >
            {pageAnnotationMarkers.map((marker) => {
              const focused = marker.annotation.id === editingAnnotationId;
              return (
                <div
                  key={marker.annotation.id}
                  data-browser-annotation-marker={marker.annotation.id}
                  className={cn(
                    "pointer-events-none absolute border-2 border-[#3b82f6] bg-[#3b82f6]/10",
                    marker.kind === "region" && "border-dashed",
                    focused && "bg-[#3b82f6]/18",
                  )}
                  style={{
                    left: marker.rect.x,
                    top: marker.rect.y,
                    width: marker.rect.width,
                    height: marker.rect.height,
                  }}
                >
                  <button
                    type="button"
                    data-browser-annotation-marker-button
                    aria-label={`Edit page annotation ${marker.index}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      editBrowserAnnotation(marker.annotation.id);
                    }}
                    className={cn(
                      "pointer-events-auto absolute -right-3 -top-3 z-10 inline-flex size-6 items-center justify-center",
                      "text-[10px] font-semibold tabular-nums text-white",
                      "drop-shadow-[0_1px_1px_rgb(0_0_0/0.16)]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/40",
                    )}
                  >
                    <AnnotationBadge index={marker.index} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {editingMarker && editingAnnotationRect && createPortal(
          <AnnotationEditor
            ref={browserAnnotationEditorRef}
            annotation={editingMarker.annotation}
            index={editingMarker.index}
            rect={editingAnnotationRect}
            showBadge={false}
            dialogLabel="Browser annotation"
            details={editingMarker.annotation.browser && editingStyleDraft ? (
              <BrowserStyleFields
                element={editingMarker.annotation.browser}
                draft={editingStyleDraft}
                onChange={(property, value) => setEditingStyleDraft((current) => (
                  current ? { ...current, [property]: value } : current
                ))}
                onReset={() => setEditingStyleDraft(
                  browserStyleDraft({
                    ...editingMarker.annotation.browser!,
                    style_changes: [],
                  }),
                )}
              />
            ) : undefined}
            onSave={(comment) => {
              if (!sessionId) return;
              const browser = editingMarker.annotation.browser;
              promptAnnotationStore.update(sessionId, editingMarker.annotation.id, {
                comment,
                ...(browser && editingStyleDraft ? {
                  browser: {
                    ...browser,
                    style_changes: browserStyleChanges(browser, editingStyleDraft),
                  },
                } : {}),
              });
              setEditingAnnotationId(null);
            }}
            onCancel={() => setEditingAnnotationId(null)}
            onRemove={() => {
              if (!sessionId) return;
              composerInsertionStore.consume(sessionId, [editingMarker.annotation.id]);
              promptAnnotationStore.remove(sessionId, editingMarker.annotation.id);
              setEditingAnnotationId(null);
            }}
          />,
          document.body,
        )}
        {resizeSnapshot && (
          <img
            data-browser-resize-snapshot
            src={resizeSnapshot}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-fill"
          />
        )}
      </div>
    </div>
  );
}

const BROWSER_STYLE_LABELS: Record<BrowserStyleProperty, string> = {
  color: "Text color",
  background: "Background",
  opacity: "Opacity",
  "font-family": "Font",
  "font-size": "Font size",
  "font-weight": "Font weight",
  "line-height": "Line height",
  "border-radius": "Corner radius",
};

function BrowserStyleFields({
  element,
  draft,
  onChange,
  onReset,
}: {
  element: NonNullable<PromptAnnotation["browser"]>;
  draft: BrowserStyleDraft;
  onChange: (property: BrowserStyleProperty, value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-fg-muted">
          <Settings2Icon className="size-4 shrink-0" />
          <span className="truncate font-mono">{element.tag_name}</span>
        </div>
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset style changes"
          title="Reset style changes"
          className="inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-subtle hover:text-fg"
        >
          <RotateCwIcon className="size-3.5" />
        </button>
      </div>
      <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
        {(Object.keys(BROWSER_STYLE_LABELS) as BrowserStyleProperty[]).map((property) => (
          <label
            key={property}
            className="grid grid-cols-[94px_minmax(0,1fr)] items-center gap-2"
          >
            <span className="text-xs text-fg-muted">{BROWSER_STYLE_LABELS[property]}</span>
            <div className="relative min-w-0">
              {(property === "color" || property === "background") && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 rounded border border-border/70"
                  style={{ background: draft[property] || "transparent" }}
                />
              )}
              <Input
                value={draft[property]}
                onChange={(event) => onChange(property, event.target.value)}
                aria-label={BROWSER_STYLE_LABELS[property]}
                className={cn(
                  "h-8 bg-bg text-xs",
                  (property === "color" || property === "background") && "pl-8",
                )}
              />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  label,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
        active
          ? "bg-brand-subtle text-brand"
          : "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "transition-colors",
      )}
    >
      {children}
    </button>
  );
}
