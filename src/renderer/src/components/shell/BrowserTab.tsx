import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  RotateCwIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  initialUrl,
  onUrlChange,
}: {
  initialUrl: string;
  onUrlChange?: (url: string) => void;
}) {
  // Electron's <webview> tag exposes a custom DOM interface (goBack,
  // canGoBack, src setter, etc.). Typing it as a structural any-shape
  // avoids pulling in Electron's renderer types (which aren't loaded
  // by tsconfig.web.json by default).
  const webviewRef = useRef<HTMLElement & {
    src: string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    getURL(): string;
  } | null>(null);
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const navigateTo = useCallback(
    (raw: string) => {
      const wv = webviewRef.current;
      if (!wv) return;
      const url = normalizeUrl(raw);
      setUrlInput(url);
      wv.src = url;
    },
    [],
  );

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onDidNavigate = () => {
      setCanBack(wv.canGoBack());
      setCanFwd(wv.canGoForward());
      const u = wv.getURL();
      setUrlInput(u);
      onUrlChange?.(u);
    };
    const onLoadStart = () => setLoading(true);
    const onLoadStop = () => setLoading(false);
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("did-start-loading", onLoadStart);
    wv.addEventListener("did-stop-loading", onLoadStop);
    return () => {
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigate);
      wv.removeEventListener("did-start-loading", onLoadStart);
      wv.removeEventListener("did-stop-loading", onLoadStop);
    };
  }, [onUrlChange]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* URL bar — back / fwd / reload + omnibox input. */}
      <div className="shrink-0 flex items-center gap-1 px-3 pt-3 pb-2">
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
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(urlInput.trim());
          }}
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL or search"
            className={cn(
              "h-7 w-full rounded-md px-2 text-xs",
              "bg-bg-surface/60 text-fg placeholder:text-fg-subtle",
              "focus:outline-none focus:bg-bg-surface",
            )}
          />
        </form>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-3">
        {/* @ts-expect-error — Electron's <webview> isn't in React's
            default JSX type registry; the runtime accepts standard
            DOM attributes verbatim. We narrow via the structural ref
            type above. */}
        <webview
          ref={webviewRef}
          src={normalizeUrl(initialUrl)}
          className="h-full w-full rounded-md bg-bg"
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
      </div>
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
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
        "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
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
