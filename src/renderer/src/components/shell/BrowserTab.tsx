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
  CameraIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  MessageCirclePlusIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  RotateCwIcon,
  SearchIcon,
  Settings2Icon,
  SmartphoneIcon,
  Trash2Icon,
  UploadIcon,
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
  browserElementAnnotationLabel,
  browserElementScreenshotName,
  browserStyleChanges,
  browserStyleDraft,
  browserRegionAnnotationLabel,
  browserRegionScreenshotName,
  type BrowserStyleDraft,
  type BrowserStyleProperty,
} from "@/lib/browser-element-annotation";
import { composerInsertionStore } from "@/lib/composer-insertions";
import {
  promptAnnotationStore,
  usePromptAnnotations,
} from "@/lib/prompt-annotations";
import {
  AnnotationBadge,
  AnnotationEditor,
} from "@/components/chat/ResponseAnnotations";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
  onUrlChange,
  onPageMeta,
}: {
  sessionId: string | null;
  tabId: string;
  active: boolean;
  visible: boolean;
  initialUrl: string;
  onUrlChange?: (url: string) => void;
  onPageMeta?: (meta: { title?: string; faviconUrl?: string }) => void;
}) {
  const navigate = useNavigate();
  // Electron's <webview> tag exposes a custom DOM interface (goBack,
  // canGoBack, src setter, etc.). Typing it as a structural any-shape
  // avoids pulling in Electron's renderer types (which aren't loaded
  // by tsconfig.web.json by default).
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const registeredWebContentsIdRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [urlFocused, setUrlFocused] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(() => normalizeUrl(initialUrl));
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [zoomFactor, setZoomFactor] = useState(1);
  const [browserPanel, setBrowserPanel] = useState<
    "import" | "passwords" | "downloads" | "clear-data" | null
  >(null);
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
  const pickerWebContentsIdRef = useRef<number | null>(null);
  const pickerSessionIdRef = useRef<string | null>(null);
  const pickerBusyRef = useRef(false);
  const hoverFrameRef = useRef<number | null>(null);
  const hoverRequestVersionRef = useRef(0);
  const pendingHoverPointRef = useRef<BrowserPoint | null>(null);
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
    let disposed = false;
    let pendingWebContentsId: number | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => {
      if (disposed || retryTimer || registeredWebContentsIdRef.current !== null) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        register();
      }, 25);
    };
    const register = () => {
      if (disposed) return;
      try {
        const webContentsId = webview.getWebContentsId();
        if (
          registeredWebContentsIdRef.current === webContentsId ||
          pendingWebContentsId === webContentsId
        ) return;
        pendingWebContentsId = webContentsId;
        void window.backchat.browserViewRegister({
          sessionId,
          tabId,
          webContentsId,
          active: activeRef.current,
        }).then(() => {
          pendingWebContentsId = null;
          if (!disposed) registeredWebContentsIdRef.current = webContentsId;
        }).catch(() => {
          pendingWebContentsId = null;
          retry();
        });
      } catch {
        retry();
      }
    };
    webview.addEventListener("dom-ready", register);
    register();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      webview.removeEventListener("dom-ready", register);
      const webContentsId = registeredWebContentsIdRef.current;
      registeredWebContentsIdRef.current = null;
      if (webContentsId !== null) {
        void window.backchat.browserViewUnregister({
          sessionId,
          tabId,
          webContentsId,
        }).catch(() => undefined);
      }
    };
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
      const url = normalizeUrl(raw);
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
    webviewRef.current?.stopFindInPage("clearSelection");
    setFindOpen(false);
    setFindQuery("");
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onFindShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind();
      } else if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        closeFind();
      }
    };
    window.addEventListener("keydown", onFindShortcut);
    return () => window.removeEventListener("keydown", onFindShortcut);
  }, [closeFind, findOpen, openFind, visible]);

  useEffect(() => {
    if (!findOpen) return;
    const query = findQuery.trim();
    if (query) webviewRef.current?.findInPage(query);
    else webviewRef.current?.stopFindInPage("clearSelection");
  }, [findOpen, findQuery]);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onDidNavigate = () => {
      setCanBack(wv.canGoBack());
      setCanFwd(wv.canGoForward());
      const u = wv.getURL();
      setUrlInput(u);
      setCurrentUrl(u);
      onUrlChange?.(u);
    };
    const onTitleUpdated = (event: Event) => {
      const title = (event as Event & { title?: string }).title?.trim();
      if (title) onPageMeta?.({ title });
    };
    const onFaviconUpdated = (event: Event) => {
      const faviconUrl = (event as Event & { favicons?: string[] }).favicons?.find(
        (candidate) => /^(https?|data):/i.test(candidate),
      );
      if (faviconUrl) onPageMeta?.({ faviconUrl });
    };
    const cacheCurrentFrame = () => {
      void captureDataUrl().then((dataUrl) => {
        if (dataUrl) cachedSnapshotRef.current = dataUrl;
      });
    };
    const onDomReady = () => {
      setCurrentUrl(wv.getURL());
      setZoomFactor(wv.getZoomFactor());
      void wv.executeJavaScript<string | null>(
        "document.querySelector('link[rel~=\"icon\"], link[rel=\"shortcut icon\"]')?.href ?? null",
      ).then((faviconUrl) => {
        if (faviconUrl && /^(https?|data):/i.test(faviconUrl)) {
          onPageMeta?.({ faviconUrl });
        }
      }).catch(() => undefined);
      cacheCurrentFrame();
    };
    const onNavigationStart = (event: Event) => {
      const navigationEvent = event as Event & { isMainFrame?: boolean };
      if (navigationEvent.isMainFrame === false) return;
      void cancelPickerRef.current();
      setLoading(true);
      setReady(false);
    };
    const onLoadStop = () => {
      setLoading(false);
      setReady(true);
      cacheCurrentFrame();
    };
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("page-title-updated", onTitleUpdated);
    wv.addEventListener("page-favicon-updated", onFaviconUpdated);
    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-start-navigation", onNavigationStart);
    wv.addEventListener("did-stop-loading", onLoadStop);
    return () => {
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("page-title-updated", onTitleUpdated);
      wv.removeEventListener("page-favicon-updated", onFaviconUpdated);
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-start-navigation", onNavigationStart);
      wv.removeEventListener("did-stop-loading", onLoadStop);
    };
  }, [captureDataUrl, onPageMeta, onUrlChange]);

  useEffect(() => {
    if (!visible) {
      setResizeSnapshot(null);
      return;
    }
    let resizing = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      if (!resizing) {
        resizing = true;
        void cancelPickerRef.current();
        const cached = cachedSnapshotRef.current;
        if (cached) {
          setResizeSnapshot(cached);
        } else {
          void captureDataUrl().then((dataUrl) => {
            if (resizing && dataUrl) setResizeSnapshot(dataUrl);
          });
        }
      }
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        resizing = false;
        setResizeSnapshot(null);
        settleTimer = undefined;
        void captureDataUrl().then((dataUrl) => {
          if (dataUrl) cachedSnapshotRef.current = dataUrl;
        });
      }, RESIZE_SNAPSHOT_SETTLE_MS);
    };

    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [captureDataUrl, visible]);

  const resetPickerUi = useCallback(() => {
    pickerWebContentsIdRef.current = null;
    pickerSessionIdRef.current = null;
    pickerBusyRef.current = false;
    pendingHoverPointRef.current = null;
    regionDragRef.current = null;
    hoverRequestVersionRef.current += 1;
    if (hoverFrameRef.current !== null) {
      cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
    setPickerHover(null);
    setRegionDrag(null);
    setIsPickingElement(false);
  }, []);

  const cancelElementPicker = useCallback(async () => {
    const webContentsId = pickerWebContentsIdRef.current;
    resetPickerUi();
    if (webContentsId === null) return;
    await window.backchat.browserElementPickerCancel({ webContentsId }).catch(() => undefined);
  }, [resetPickerUi]);
  cancelPickerRef.current = cancelElementPicker;

  useEffect(() => () => {
    const webContentsId = pickerWebContentsIdRef.current;
    if (hoverFrameRef.current !== null) cancelAnimationFrame(hoverFrameRef.current);
    if (webContentsId !== null) {
      void window.backchat.browserElementPickerCancel({ webContentsId });
    }
  }, []);

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
    const annotation: PromptAnnotation = {
      id: annotationId,
      kind: "browser_element",
      source_session_id: destinationSessionId,
      source_turn_id: "browser",
      text: browserElementAnnotationLabel(result.element),
      browser: {
        ...result.element,
        screenshot_name: attachment?.name ?? "",
      },
    };
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
    const annotation: PromptAnnotation = {
      id: annotationId,
      kind: "browser_region",
      source_session_id: destinationSessionId,
      source_turn_id: "browser",
      text: browserRegionAnnotationLabel(result.region),
      browser_region: {
        ...result.region,
        screenshot_name: attachment?.name ?? "",
      },
    };
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

  const beginElementPicker = useCallback(async () => {
    const webview = webviewRef.current;
    const destinationSessionId = visible ? sessionId : null;
    if (!webview || !destinationSessionId) return;
    try {
      const webContentsId = webview.getWebContentsId();
      await window.backchat.browserElementPickerBegin({ webContentsId });
      pickerWebContentsIdRef.current = webContentsId;
      pickerSessionIdRef.current = destinationSessionId;
      setPickerHover(null);
      setRegionDrag(null);
      setIsPickingElement(true);
    } catch (error) {
      resetPickerUi();
      toast.error("Couldn't start page annotation", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [resetPickerUi, sessionId, visible]);

  const annotatePageElement = useCallback(async () => {
    if (isPickingElement) {
      await cancelElementPicker();
      return;
    }
    await beginElementPicker();
  }, [beginElementPicker, cancelElementPicker, isPickingElement]);

  const editBrowserAnnotation = useCallback((annotationId: string) => {
    setEditingAnnotationId(annotationId);
  }, []);

  const requestElementHover = useCallback((point: BrowserPoint) => {
    pendingHoverPointRef.current = point;
    if (hoverFrameRef.current !== null || pickerBusyRef.current) return;
    hoverFrameRef.current = requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const nextPoint = pendingHoverPointRef.current;
      const webContentsId = pickerWebContentsIdRef.current;
      if (!nextPoint || webContentsId === null || pickerBusyRef.current) return;
      const requestVersion = ++hoverRequestVersionRef.current;
      void window.backchat.browserElementPickerHover({
        webContentsId,
        ...nextPoint,
      }).then((hover) => {
        if (
          pickerWebContentsIdRef.current === webContentsId &&
          requestVersion === hoverRequestVersionRef.current &&
          !pickerBusyRef.current
        ) {
          setPickerHover(hover);
        }
      }).catch(() => undefined);
    });
  }, []);

  const commitElementAt = useCallback(async (point: BrowserPoint) => {
    const webContentsId = pickerWebContentsIdRef.current;
    const destinationSessionId = pickerSessionIdRef.current;
    if (webContentsId === null || !destinationSessionId || pickerBusyRef.current) return;
    pickerBusyRef.current = true;
    try {
      const hover = await window.backchat.browserElementPickerHover({
        webContentsId,
        ...point,
      });
      if (!hover) {
        pickerBusyRef.current = false;
        setPickerHover(null);
        return;
      }
      setPickerHover(hover);
      const result = await window.backchat.browserElementPickerCommit({ webContentsId });
      if (!result) {
        pickerBusyRef.current = false;
        return;
      }
      await addElementResult(destinationSessionId, result);
      resetPickerUi();
      refreshSnapshot();
      await beginElementPicker();
    } catch (error) {
      await window.backchat.browserElementPickerCancel({ webContentsId }).catch(() => undefined);
      resetPickerUi();
      toast.error("Couldn't annotate this page", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [addElementResult, beginElementPicker, refreshSnapshot, resetPickerUi]);

  const captureRegion = useCallback(async (
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    const webContentsId = pickerWebContentsIdRef.current;
    const destinationSessionId = pickerSessionIdRef.current;
    if (webContentsId === null || !destinationSessionId || pickerBusyRef.current) return;
    pickerBusyRef.current = true;
    try {
      const result = await window.backchat.browserElementPickerCaptureRegion({
        webContentsId,
        rect,
      });
      await addRegionResult(destinationSessionId, result);
      resetPickerUi();
      refreshSnapshot();
      await beginElementPicker();
    } catch (error) {
      await window.backchat.browserElementPickerCancel({ webContentsId }).catch(() => undefined);
      resetPickerUi();
      toast.error("Couldn't capture this page region", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [addRegionResult, beginElementPicker, refreshSnapshot, resetPickerUi]);

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
    requestElementHover(point);
  }, [pointerPoint, requestElementHover]);

  const onPickerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pickerBusyRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPoint(event);
    const drag = { start: point, current: point };
    regionDragRef.current = drag;
    setRegionDrag(drag);
  }, [pointerPoint]);

  const onPickerPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = regionDragRef.current;
    if (!drag || event.button !== 0 || pickerBusyRef.current) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const end = pointerPoint(event);
    regionDragRef.current = null;
    setRegionDrag(null);
    const gesture = browserAnnotationGesture(drag.start, end);
    if (gesture.kind === "region") {
      void captureRegion(gesture.rect);
    } else {
      void commitElementAt(end);
    }
  }, [captureRegion, commitElementAt, pointerPoint]);

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
      {/* Browser chrome stays visually attached to the task tab row. */}
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
              value={urlInput === "about:blank" ? "" : urlFocused ? urlInput : addressLabel(urlInput)}
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Browser menu"
              title="Browser menu"
              className={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
                "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
                "transition-colors",
              )}
            >
              <EllipsisVerticalIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-64 p-1.5">
            <DropdownMenuItem onSelect={openFind} className="h-8 gap-2 text-xs">
              <SearchIcon className="size-3.5" />
              <span>Find in page</span>
              <span className="ml-auto text-[10px] text-fg-subtle">⌘F</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void printPage()} className="h-8 gap-2 text-xs">
              <PrinterIcon className="size-3.5" />
              Print
            </DropdownMenuItem>
            <div className="flex h-9 items-center gap-2 px-1.5 text-xs text-fg">
              <span className="mr-auto">Zoom</span>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => changeZoom(-0.1)}
                className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-surface hover:text-fg"
              >
                <MinusIcon className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                onClick={resetZoom}
                className="min-w-10 rounded-md px-1 py-1 tabular-nums text-fg-muted hover:bg-bg-surface hover:text-fg"
              >
                {Math.round(zoomFactor * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => changeZoom(0.1)}
                className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-surface hover:text-fg"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void showDeviceToolbar()}
              className="h-8 gap-2 text-xs"
            >
              <SmartphoneIcon className="size-3.5" />
              Show device toolbar
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void captureScreenshot()}
              className="h-8 gap-2 text-xs"
            >
              <CameraIcon className="size-3.5" />
              Capture screenshot
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => webviewRef.current?.reload()}
              className="h-8 gap-2 text-xs"
            >
              <RotateCwIcon className="size-3.5" />
              Reload page
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyAddress} className="h-8 gap-2 text-xs">
              <CopyIcon className="size-3.5" />
              Copy address
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={openExternal}
              disabled={!canOpenExternal}
              className="h-8 gap-2 text-xs"
            >
              <ExternalLinkIcon className="size-3.5" />
              Open in default browser
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setBrowserPanel("import")}
              className="h-8 gap-2 text-xs"
            >
              <UploadIcon className="size-3.5" />
              Import cookies and passwords…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setBrowserPanel("passwords")}
              className="h-8 gap-2 text-xs"
            >
              <KeyRoundIcon className="size-3.5" />
              Passwords and autofill
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setBrowserPanel("downloads")}
              className="h-8 gap-2 text-xs"
            >
              <DownloadIcon className="size-3.5" />
              Downloads
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setBrowserPanel("clear-data")}
              className="h-8 gap-2 text-xs"
            >
              <Trash2Icon className="size-3.5" />
              Clear browsing data
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void navigate({ to: "/settings/browser" })}
              className="h-8 gap-2 text-xs"
            >
              <Settings2Icon className="size-3.5" />
              Browser settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        open={browserPanel !== null}
        onOpenChange={(open) => {
          if (!open) setBrowserPanel(null);
        }}
      >
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          {browserPanel === "import" && (
            <>
              <DialogHeader className="border-b border-border/60 p-4">
                <DialogTitle>Import cookies and passwords</DialogTitle>
                <DialogDescription>
                  Import from an installed browser profile. Exported cookie or password files are not accepted.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 p-4 text-xs text-fg-muted">
                <div className="rounded-lg border border-border/60 bg-bg-surface/40 p-3">
                  <div className="flex items-center gap-2 text-fg">
                    <UploadIcon className="size-4" />
                    <span className="font-medium">System browser profiles</span>
                  </div>
                  <p className="mt-1.5 leading-5">
                    Profile migration is scoped to local browser data and will never read an exported file.
                  </p>
                </div>
                <p>Install or sign in to a supported browser first, then run the migration from this panel.</p>
              </div>
              <DialogFooter className="border-t border-border/60 p-3">
                <Button type="button" variant="outline" onClick={() => setBrowserPanel(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
          {browserPanel === "passwords" && (
            <>
              <DialogHeader className="border-b border-border/60 p-4">
                <DialogTitle>Passwords and autofill</DialogTitle>
                <DialogDescription>
                  Saved credentials stay in the main process and are only filled after you choose them.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-72 overflow-y-auto p-3">
                {credentials.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 p-5 text-center text-xs text-fg-muted">
                    No saved passwords in this browser profile.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {credentials.map((credential) => (
                      <div key={credential.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-bg-surface/60">
                        <KeyRoundIcon className="size-4 shrink-0 text-fg-subtle" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-fg">{credential.origin}</div>
                          <div className="truncate text-[11px] text-fg-muted">{credential.username}</div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void window.backchat.browserCredentialFill({
                            webContentsId: browserWebContentsId(),
                            credentialId: credential.id,
                          })}
                        >
                          Fill
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${credential.origin}`}
                          onClick={() => void window.backchat.browserCredentialDelete({
                            webContentsId: browserWebContentsId(),
                            credentialId: credential.id,
                          }).then(loadCredentials)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {browserPanel === "downloads" && (
            <>
              <DialogHeader className="border-b border-border/60 p-4">
                <DialogTitle>Downloads</DialogTitle>
                <DialogDescription>Files downloaded by the in-app browser.</DialogDescription>
              </DialogHeader>
              <div className="max-h-72 overflow-y-auto p-3">
                {downloads.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 p-5 text-center text-xs text-fg-muted">
                    No downloads yet.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {downloads.map((download) => (
                      <div key={download.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-bg-surface/60">
                        <DownloadIcon className="size-4 shrink-0 text-fg-subtle" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-fg">{download.fileName}</div>
                          <div className="truncate text-[11px] text-fg-muted">{download.state}</div>
                        </div>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void window.backchat.browserDownloadAction({
                          webContentsId: browserWebContentsId(), downloadId: download.id, action: "reveal",
                        })}>Show</Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {browserPanel === "clear-data" && (
            <>
              <DialogHeader className="border-b border-border/60 p-4">
                <DialogTitle>Clear browsing data</DialogTitle>
                <DialogDescription>Choose what to remove from this browser profile.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 p-4">
                {([
                  ["history", "Browsing history"],
                  ["cookies", "Cookies and site data"],
                  ["cache", "Cached images and files"],
                  ["passwords", "Saved passwords"],
                ] as const).map(([kind, label]) => (
                  <label key={kind} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs text-fg">
                    <Checkbox
                      checked={clearKinds.includes(kind)}
                      onCheckedChange={(checked) => setClearKinds((current) => checked
                        ? [...new Set([...current, kind])]
                        : current.filter((candidate) => candidate !== kind))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <DialogFooter className="border-t border-border/60 p-3">
                <Button type="button" variant="outline" onClick={() => setBrowserPanel(null)}>Cancel</Button>
                <Button type="button" onClick={() => void clearBrowsingData()} disabled={clearKinds.length === 0}>Clear data</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {findOpen && (
        <form
          className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 px-3"
          onSubmit={(event) => {
            event.preventDefault();
            const query = findQuery.trim();
            if (query) webviewRef.current?.findInPage(query, { forward: true, findNext: true });
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
          src={normalizeUrl(initialUrl || "about:blank")}
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

/** http(s) / file URL → as-is. Bare word with a dot → assume http
 *  (`localhost:3000`, `example.com`). Anything else → Google search. */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "about:blank";
  if (/^(https?|file|about):/i.test(t)) return t;
  if (/^\//.test(t)) return "file://" + t;
  if (/^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(t)) return "https://" + t;
  return "https://www.google.com/search?q=" + encodeURIComponent(t);
}

function addressLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
    }
  } catch {
    // Keep the raw value while a user is entering an incomplete address.
  }
  return url;
}
