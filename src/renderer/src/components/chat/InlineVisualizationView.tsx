import { useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { StatusNotice } from "@/components/ui/status-notice";
import { useSettings } from "@/lib/settings-store";
import { useI18n } from "@/lib/i18n";
import {
  buildInlineVisualizationDocument,
  clampInlineVisualizationHeight,
  resolveInlineVisualizationTheme,
} from "@/lib/inline-visualization";
import { InteractiveFrameSurface } from "./InteractiveFrameSurface";

const HOST_THEME_TOKENS = [
  "--bg",
  "--bg-surface",
  "--bg-bubble",
  "--fg",
  "--fg-muted",
  "--border",
  "--border-strong",
  "--danger",
  "--brand",
  "--warning",
  "--success",
  "--accent-violet",
  "--info",
] as const;

function hostTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const tokens = Object.fromEntries(
    HOST_THEME_TOKENS.map((name) => [name, styles.getPropertyValue(name)]),
  );
  tokens["font-size"] = styles.fontSize;
  return resolveInlineVisualizationTheme(tokens);
}

export function InlineVisualizationView({
  file,
  cwd,
  sessionId,
  surfaceId,
}: {
  file: string;
  cwd: string;
  sessionId: string;
  surfaceId: string;
}) {
  const { t } = useI18n();
  const settings = useSettings();
  const [fragment, setFragment] = useState<string>();
  const [documentUrl, setDocumentUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [requestedHeight, setRequestedHeight] = useState(1);
  const [iframeElement, setIframeElement] = useState<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let watchId: string | undefined;
    let refreshing = false;
    let refreshAgain = false;
    setFragment(undefined);
    setDocumentUrl(undefined);
    setError(undefined);
    const refresh = async (): Promise<void> => {
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      try {
        const result = await window.backchat.inlineVisualizationRead({ cwd, file });
        if (!cancelled) {
          setFragment((current) => current === result.content ? current : result.content);
          setError(undefined);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        refreshing = false;
        if (refreshAgain && !cancelled) {
          refreshAgain = false;
          void refresh();
        }
      }
    };
    const unsubscribe = window.backchat.onInlineVisualizationChanged((event) => {
      if (event.watch_id === watchId) void refresh();
    });
    void (async () => {
      await refresh();
      if (cancelled) return;
      const watched = await window.backchat.inlineVisualizationWatch({ cwd, file });
      if (cancelled) {
        await window.backchat.inlineVisualizationUnwatch(watched);
        return;
      }
      watchId = watched.watch_id;
      await refresh();
    })().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (watchId) void window.backchat.inlineVisualizationUnwatch({ watch_id: watchId });
    };
  }, [cwd, file]);

  const documentHtml = useMemo(
    () => fragment === undefined ? undefined : buildInlineVisualizationDocument(fragment, hostTheme()),
    [fragment, settings?.appearance.theme, settings?.appearance.light_theme_id, settings?.appearance.dark_theme_id],
  );

  useEffect(() => {
    if (!documentHtml) return;
    let cancelled = false;
    void window.backchat.inlineVisualizationRegisterDocument({ html: documentHtml })
      .then(({ document_url: nextUrl }) => {
        if (!cancelled) setDocumentUrl(nextUrl);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [documentHtml]);

  useEffect(() => {
    if (!iframeElement) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeElement.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data.type === "openma:inline-visualization:resize" && typeof data.height === "number") {
        setRequestedHeight(clampInlineVisualizationHeight(data.height));
      }
      if (data.type === "openma:inline-visualization:follow-up" && typeof data.prompt === "string") {
        const text = data.prompt.trim();
        if (!text) return;
        void window.backchat.sessionPrompt({
          session_id: sessionId,
          turn_id: crypto.randomUUID(),
          text,
          prompt_intent: "queue",
          requested_delivery: "turn_end",
          effective_delivery: "turn_end",
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [iframeElement, sessionId]);

  if (error) {
    return (
      <StatusNotice tone="danger" className="mt-2 min-h-16 items-center">
        <span className="break-words">{t("visualization.error")}: {error}</span>
      </StatusNotice>
    );
  }
  if (!documentUrl) {
    return (
      <div className="mt-2 flex h-28 items-center justify-center gap-2 rounded-xl bg-bg-surface text-xs text-fg-muted" role="status">
        <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
        {t("visualization.loading")}
      </div>
    );
  }

  const label = file.split("/").pop() || t("visualization.label");
  return (
    <InteractiveFrameSurface
      surfaceId={surfaceId}
      sessionId={sessionId}
      label={label}
      displayMode="inline"
      onDisplayModeChange={() => undefined}
      availableDisplayModes={["inline"]}
      frameChrome="none"
    >
      <iframe
        ref={setIframeElement}
        title={label}
        sandbox="allow-scripts"
        src={documentUrl}
        scrolling="no"
        className="block w-full border-0 bg-transparent transition-[height] duration-150 ease-out motion-reduce:transition-none"
        style={{ height: requestedHeight }}
      />
    </InteractiveFrameSurface>
  );
}
