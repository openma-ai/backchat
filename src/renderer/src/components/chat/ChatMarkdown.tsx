import { useI18n } from "@/lib/i18n";
import {
  createContext,
  createElement,
  useContext,
  type AnchorHTMLAttributes,
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";

import { openBrowserAwareUrl } from "@/lib/browser-open";
import { splitInlineVisualizations } from "@/lib/inline-visualization";
import {
  resolveMarkdownLinkTarget,
} from "@/lib/markdown-link-target";
import { cn } from "@/lib/utils";
import { previewLocalFile } from "@/lib/file-preview";
import { InlineVisualizationView } from "./InlineVisualizationView";

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
export const MARKDOWN_BLOCK_RHYTHM = cn(
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:leading-6",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:leading-6",
  "[&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:leading-6",
  "[&_h4]:mt-2 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:leading-6",
  "[&_p]:my-1.5",
  // Tailwind's preflight removes list markers, and these surfaces only set list
  // margins — so a markdown list rendered as unmarked lines that read as one
  // paragraph per item. Descendant selectors, because a nested list is not a
  // direct child and was losing its markers even where the top level kept them.
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5 [&_li]:py-0 [&_li>p]:my-0",
  "[&_pre]:my-2 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-bg-surface/60 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-[12px] [&_pre]:leading-5 [&_pre]:overflow-x-auto",
  "[&_code]:rounded [&_code]:bg-bg-surface/70 [&_code]:px-[0.35em] [&_code]:py-[0.1em] [&_code]:font-mono [&_code]:text-[0.9em]",
  "[&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:py-0 [&_pre_code]:text-[12px]",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
  "[&_th]:border [&_th]:border-border/60 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-[12px] [&_th]:font-semibold [&_th]:leading-5",
  "[&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_td]:text-[12px] [&_td]:leading-5",
  "[&_hr]:my-3 [&_hr]:border-border/60",
  "[&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-fg-muted",
  "[&_strong]:font-semibold [&_em]:italic",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
);

export const ASSISTANT_MARKDOWN_CLASS = cn(
  // The chat stack, wherever this markdown lands. The rule that picks it applies
  // to the prompt and the answer, so the same agent prose rendered inside the
  // work block came out in the UI font — one paragraph in two typefaces.
  "font-chat text-[13px] leading-6 text-fg",
  MARKDOWN_BLOCK_RHYTHM,
);

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
  const Component = Streamdown as unknown as ComponentType<{
    children: string;
    className?: string;
    controls?: { code?: boolean; table?: boolean; mermaid?: boolean };
    linkSafety?: boolean;
    components?: Record<string, ComponentType<unknown>>;
  }>;
  const renderMarkdown = (source: string, key?: string) =>
    createElement(Component, {
      key,
      className,
      children: source,
      controls: { code: false, table: false, mermaid: false },
      linkSafety: false,
      components: streamdownOverrides,
    });
  const segments = splitInlineVisualizations(text);
  if (!cwd || (segments.length === 1 && segments[0]?.kind === "markdown")) {
    return renderMarkdown(text);
  }
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "markdown"
          ? renderMarkdown(segment.text, `markdown-${index}`)
          : (
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

const streamdownOverrides = {
  // Streamdown wraps a table in a bordered card with its own toolbar row. The
  // streaming renderer emits a bare table, so the same document was 40px taller
  // once it settled. A plain table on both sides, styled by the shared rhythm.
  table: ({
    className: _className,
    children,
    ...rest
  }: HTMLAttributes<HTMLTableElement>) => (
    <table {...rest} className="my-2 w-full border-collapse">
      {children}
    </table>
  ),
  pre: ({
    className: _className,
    children,
    ...rest
  }: HTMLAttributes<HTMLPreElement>) => (
    <pre
      {...rest}
      className={cn(
        "my-2 overflow-x-auto rounded-lg border border-border/60 bg-bg-surface/60",
        "px-3 py-2 text-[12px] leading-5 font-mono",
      )}
    >
      {children}
    </pre>
  ),
  code: ({
    className,
    children,
    ...rest
  }: HTMLAttributes<HTMLElement>) => {
    if (className?.startsWith("language-")) {
      return (
        <code {...rest} className={className}>
          {children}
        </code>
      );
    }
    return (
      <code
        {...rest}
        className={cn(
          "rounded bg-bg-surface/70 px-[0.35em] py-[0.1em]",
          "font-mono text-[0.9em] text-fg",
        )}
      >
        {children}
      </code>
    );
  },
  a: MarkdownAnchor,
} as unknown as Record<string, ComponentType<unknown>>;

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
  return (
    <a
      {...rest}
      href={url}
      onClick={onClick}
      className="text-fg underline underline-offset-2 hover:text-fg-muted"
    >
      {children}
    </a>
  );
}
