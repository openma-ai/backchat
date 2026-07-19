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

export const ASSISTANT_MARKDOWN_CLASS = cn(
  "text-[13px] leading-6 text-fg",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&>p]:my-1.5 [&>ul]:my-1.5 [&>ol]:my-1.5 [&>pre]:my-2",
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
  const cwd = useMarkdownCwd();
  const url = (href ?? "").trim();
  const target = resolveMarkdownLinkTarget(url, cwd);
  if (target.kind === "inert" || !url) {
    return (
      <span
        className="underline decoration-dotted underline-offset-2 text-fg"
        title="Bare relative path — no resolvable target"
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
