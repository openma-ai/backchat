import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CodeIcon, EyeIcon, FileIcon, FileTextIcon, XIcon } from "@/components/Icons";
import { FileOpenMenu } from "@/components/shell/FileOpenMenu";
import { StreamdownText, ASSISTANT_MARKDOWN_CLASS } from "@/components/chat/ChatMarkdown";
import {
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  PLAIN_LANGUAGE,
  highlightCode,
  languageForPath,
} from "@/lib/code-highlight";
import { previewLocalFile } from "@/lib/file-preview";
import { useI18n } from "@/lib/i18n";
import { sessionStore } from "@/lib/session-store";
import { cn } from "@/lib/utils";

type FileContent = Awaited<ReturnType<typeof window.backchat.uiFsReadContent>>;

type Loaded =
  | { status: "loading" }
  | { status: "ready"; content: FileContent; language: string; html: string | null; tabPreview: boolean };

const MARKDOWN_LANGUAGES = new Set(["markdown", "mdx"]);

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function fileExtension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function dirname(path: string): string {
  const index = path.replace(/[\\/]+$/, "").search(/[\\/][^\\/]*$/);
  return index > 0 ? path.slice(0, index) : path;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;");
}

/** Same line structure shiki emits, so plain text gets the same gutter. */
function plainHtml(text: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return `<pre class="shiki"><code>${lines.map((line) => `<span class="line">${escapeHtml(line)}</span>`).join("\n")}</code></pre>`;
}

function openDefault(path: string) {
  void window.backchat.uiFsOpenPath({ path }).then((error) => {
    if (error) toast.error("Couldn't open file", { description: error });
  });
}

/**
 * Inline viewer for one local file inside the Files tab: highlighted
 * source with line numbers, rendered/source Markdown, images, and a quiet
 * card for formats that only open in their desktop app.
 */
export function FilePreviewPane({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [markdownSource, setMarkdownSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded({ status: "loading" });
    void (async () => {
      const [content, language, preview] = await Promise.all([
        // Async wrappers turn a missing bridge method (stale preload after
        // an update) into an error card instead of an endless spinner.
        (async () => window.backchat.uiFsReadContent({ path }))().catch(
          (error: unknown): FileContent => ({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
        languageForPath(path).catch(() => PLAIN_LANGUAGE),
        (async () => window.backchat.uiFsResolvePreview({ path }))().catch(() => null),
      ]);
      let html: string | null = null;
      if (content.kind === "text") {
        const lines = content.content.split("\n").length;
        const highlightable = content.content.length <= HIGHLIGHT_MAX_CHARS && lines <= HIGHLIGHT_MAX_LINES;
        html = highlightable
          ? await highlightCode(content.content, language).catch(() => null)
          : null;
        html ??= plainHtml(content.content);
      }
      // PDF, rendered DOCX and HTML have a real rendering the browser tab
      // can show; offer it next to the inline source/card.
      const tabPreview = preview?.kind === "document" || preview?.kind === "web";
      if (!cancelled) setLoaded({ status: "ready", content, language, html, tabPreview });
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const ready = loaded.status === "ready" ? loaded : null;
  const isMarkdown = !!ready && ready.content.kind === "text" && MARKDOWN_LANGUAGES.has(ready.language);
  const extension = fileExtension(path);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-file-preview={path}>
      <div className="side-panel-title-row flex h-11 shrink-0 items-center gap-2 border-b border-border/55">
        <div className="flex min-w-0 flex-1 items-center gap-1.5" title={path}>
          <FileTextIcon className="size-3.5 shrink-0 text-fg-muted" />
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate text-xs font-medium text-fg">{fileName(path)}</span>
            {extension && (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                {extension}
              </span>
            )}
          </div>
        </div>
        {isMarkdown && (
          <div className="flex shrink-0 items-center" role="group" aria-label={t("filePreview.mode")}>
            <TitleIconButton
              label={t("filePreview.rendered")}
              pressed={!markdownSource}
              onClick={() => setMarkdownSource(false)}
            >
              <EyeIcon className="size-3.5" />
            </TitleIconButton>
            <TitleIconButton
              label={t("filePreview.source")}
              pressed={markdownSource}
              onClick={() => setMarkdownSource(true)}
            >
              <CodeIcon className="size-3.5" />
            </TitleIconButton>
          </div>
        )}
        {ready?.tabPreview && (
          <TitleIconButton label={t("filePreview.openInTab")} onClick={() => void previewLocalFile(path)}>
            <EyeIcon className="size-3.5" />
          </TitleIconButton>
        )}
        <TitleIconButton label={t("filePreview.close")} onClick={onClose}>
          <XIcon className="size-3.5" />
        </TitleIconButton>
        <FileOpenMenu
          path={path}
          onOpenDefault={() => openDefault(path)}
          onReveal={() => void window.backchat.uiFsRevealPath({ path })}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {ready ? (
          <PreviewBody
            path={path}
            loaded={ready}
            markdownSource={markdownSource}
            isMarkdown={isMarkdown}
          />
        ) : (
          <div className="px-4 py-3 text-xs text-fg-subtle">{t("fileTree.loading")}</div>
        )}
      </div>
    </div>
  );
}

function TitleIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors",
        "hover:bg-[var(--control-bg-hover)] hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed && "bg-[var(--control-bg-hover)] text-fg",
      )}
    >
      {children}
    </button>
  );
}

function PreviewBody({
  path,
  loaded,
  markdownSource,
  isMarkdown,
}: {
  path: string;
  loaded: Extract<Loaded, { status: "ready" }>;
  markdownSource: boolean;
  isMarkdown: boolean;
}) {
  const { t } = useI18n();
  const { content, html } = loaded;
  const sessionId = sessionStore.active()?.id ?? "";

  if (content.kind === "text") {
    if (isMarkdown && !markdownSource) {
      return (
        <div className="oma-scrollbar h-full overflow-auto px-5 py-4">
          <StreamdownText
            text={content.content}
            className={ASSISTANT_MARKDOWN_CLASS}
            cwd={dirname(path)}
            sessionId={sessionId}
            surfacePrefix={`file-preview-${path}`}
          />
          {content.truncated && <TruncatedNote size={content.size} />}
        </div>
      );
    }
    return <CodeView html={html ?? ""} truncated={content.truncated} size={content.size} />;
  }
  if (content.kind === "image") {
    return (
      <div className="oma-scrollbar flex h-full items-center justify-center overflow-auto p-4">
        <img
          src={content.dataUrl}
          alt={fileName(path)}
          draggable={false}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  const message =
    content.kind === "too-large"
      ? t("filePreview.tooLarge", { size: formatBytes(content.size) })
      : content.kind === "binary"
        ? t("filePreview.binary")
        : content.kind === "error"
          ? content.message
          : t("filePreview.unavailable");
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-[280px]">
        <FileIcon className="mx-auto size-9 text-fg-subtle" />
        <p className="mt-3 truncate text-sm font-medium text-fg">{fileName(path)}</p>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{message}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {loaded.tabPreview && (
            <button
              type="button"
              onClick={() => void previewLocalFile(path)}
              className="inline-flex h-8 items-center rounded-lg bg-fg px-3 text-xs font-medium text-bg transition-opacity hover:opacity-85"
            >
              {t("filePreview.openInTab")}
            </button>
          )}
          <button
            type="button"
            onClick={() => openDefault(path)}
            className={cn(
              "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-colors",
              loaded.tabPreview
                ? "text-fg-muted hover:bg-[var(--control-bg-hover)] hover:text-fg"
                : "bg-fg text-bg hover:opacity-85",
            )}
          >
            {t("fileTree.openWithDefaultApp")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CodeView({ html, truncated, size }: { html: string; truncated: boolean; size: number }) {
  // Gutter width follows the digit count of the last line number.
  const gutter = useMemo(() => {
    const lines = (html.match(/class="line"/g) ?? []).length;
    return `${Math.max(2, String(lines).length)}ch`;
  }, [html]);
  return (
    <div className="oma-scrollbar h-full overflow-auto">
      <div
        className="file-preview-code"
        style={{ "--file-preview-gutter": gutter } as React.CSSProperties}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {truncated && <TruncatedNote size={size} />}
    </div>
  );
}

function TruncatedNote({ size }: { size: number }) {
  const { t } = useI18n();
  return (
    <p className="px-4 pb-4 text-xs text-fg-subtle">
      {t("filePreview.truncated", { size: formatBytes(size) })}
    </p>
  );
}
