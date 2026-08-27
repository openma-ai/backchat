import { useI18n } from "@/lib/i18n";
import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import {
  CHAT_ASSISTANT_MARKDOWN_CLASS,
  CHAT_MARKDOWN_BLOCK_RHYTHM,
  CHAT_MARKDOWN_PROSE_CLASS,
  ChatMarkdown,
} from "@openma/common/chat-ui";

import { openBrowserAwareUrl } from "@/lib/browser-open";
import { splitInlineVisualizations } from "@/lib/inline-visualization";
import { resolveMarkdownLinkTarget } from "@/lib/markdown-link-target";
import { previewLocalFile } from "@/lib/file-preview";
import { InlineVisualizationView } from "./InlineVisualizationView";
import { MarkdownLinkFavicon } from "./MarkdownLinkFavicon";
import { MarkdownLinkMenu } from "./MarkdownLinkMenu";

const MarkdownCwdContext = createContext<string | null>(null);

/** One block rhythm for both markdown surfaces. The settled surface is rendered
 *  by Streamdown, which puts its own utility classes on every element it emits
 *  (`text-2xl` on h2, `py-1` on li, `px-4 py-2 text-sm` on td). Those classes
 *  only exist in the stylesheet when our own source happens to use them too, so
 *  the settled heading scale was part generated and part inherited — an h2 three
 *  times the body size next to an h1 at body size. The streaming surface then
 *  chased it with a hand-written near-twin, and the two disagreed by a hundred
 *  pixels on the same document, which is what jumped when a turn settled.
 *
 *  Container-scoped element selectors outrank plain utility classes, so stating
 *  the rhythm once here governs both renderers. */
export const MARKDOWN_BLOCK_RHYTHM = CHAT_MARKDOWN_BLOCK_RHYTHM;

/** The reading tier. The chat stack, wherever this markdown lands: the rule
 *  that picks it applies to the prompt and the answer, so the same agent prose
 *  rendered inside the work block came out in the UI font — one paragraph in
 *  two typefaces.
 *
 *  14px sits one step above the 13px activity/metadata tier that surrounds it.
 *  The transcript is the only long-form surface in the product and it is
 *  frequently CJK, which needs more pixels per glyph than Latin to hold its
 *  strokes; at 13px those strokes fell below one device pixel and the prose
 *  read as dim rather than as small.
 *
 *  Both renderers state this from the one constant. A literal repeated in the
 *  streaming twin is how the two surfaces drifted apart before. */
export const MARKDOWN_PROSE_TYPE = CHAT_MARKDOWN_PROSE_CLASS;

export const ASSISTANT_MARKDOWN_CLASS = CHAT_ASSISTANT_MARKDOWN_CLASS;

export function MarkdownCwdProvider({
  cwd,
  children,
}: {
  cwd: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <MarkdownCwdContext.Provider value={cwd ?? null}>
      {children}
    </MarkdownCwdContext.Provider>
  );
}

export function useMarkdownCwd(): string | null {
  return useContext(MarkdownCwdContext);
}

export function StreamdownText({
  text,
  className,
  cwd,
  sessionId,
  surfacePrefix,
}: {
  text: string;
  className?: string;
  cwd: string | null;
  sessionId: string;
  surfacePrefix: string;
}) {
  const renderMarkdown = (source: string, key?: string) =>
    <ChatMarkdown
      key={key}
      text={source}
      className={className}
      components={{ a: MarkdownAnchor }}
    />;
  const segments = splitInlineVisualizations(text);
  if (!cwd || (segments.length === 1 && segments[0]?.kind === "markdown")) {
    return renderMarkdown(text);
  }
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "markdown" ? (
          renderMarkdown(segment.text, `markdown-${index}`)
        ) : (
          <InlineVisualizationView
            key={`visualization-${index}`}
            file={segment.file}
            cwd={cwd}
            sessionId={sessionId}
            surfaceId={`inline-vis-${surfacePrefix}-${index}`}
          />
        ),
      )}
    </>
  );
}

export function MarkdownAnchor({
  href,
  children,
  className: _className,
  onClick: _onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { t } = useI18n();
  const cwd = useMarkdownCwd();
  const url = (href ?? "").trim();
  const target = resolveMarkdownLinkTarget(url, cwd);
  if (target.kind === "inert" || !url) {
    return (
      <span
        className="underline decoration-dotted underline-offset-2 text-fg"
        title={t("chat.bareRelativePath")}
      >
        {children}
      </span>
    );
  }
  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (target.kind === "http") {
      openBrowserAwareUrl(target.url);
      return;
    }
    void previewLocalFile(target.path);
  };
  const anchor = (
    <a
      {...rest}
      href={url}
      onClick={onClick}
      className={
        target.kind === "http"
          ? "text-info underline underline-offset-2 hover:text-info/80"
          : "text-fg underline underline-offset-2 hover:text-fg-muted"
      }
      data-markdown-http-link={target.kind === "http" ? "true" : undefined}
    >
      {target.kind === "http" && <MarkdownLinkFavicon url={target.url} />}
      {children}
    </a>
  );
  if (target.kind !== "http") return anchor;
  const label = typeof children === "string" ? children : undefined;
  return (
    <MarkdownLinkMenu url={target.url} label={label}>
      {anchor}
    </MarkdownLinkMenu>
  );
}
