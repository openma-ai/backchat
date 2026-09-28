import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AgentUIStreamingMarkdown } from "@openma/common/agent-ui/react";
import { ContextMenu } from "radix-ui";
import { MARKDOWN_BLOCK_RHYTHM, MARKDOWN_PROSE_TYPE } from "./ChatMarkdown";
import { sessionStore } from "@/lib/session-store";
import { openBrowserAwareUrl } from "@/lib/browser-open";
import { resolveMarkdownLinkTarget } from "@/lib/markdown-link-target";
import { previewLocalFile } from "@/lib/file-preview";
import { cn } from "@/lib/utils";
import { decorateStreamingHttpLinks } from "./MarkdownLinkFavicon";
import { MarkdownLinkMenuContent } from "./MarkdownLinkMenu";

interface Props {
  turnId: string;
  kind: "assistant" | "thought";
  className?: string;
  /** Base dir used to resolve bare-relative href links into absolute
   *  file paths before handing them to uiFsOpenPath. Typically the
   *  active session's cwd. When omitted, relative links are no-op'd
   *  on click instead of being navigated. */
  cwd?: string | null;
  /** Number of characters to skip from the START of the replayed
   *  accumulator on mount. Used by segment-aware interleaving — when
   *  a tool breaks the assistant flow, earlier text segments are
   *  rendered statically by the parent above the tool; this component
   *  mounts AFTER the tool and should only render the TAIL of the
   *  accumulator (everything since the last flush). Live deltas that
   *  arrive after mount are always appended in full — only the initial
   *  replay is sliced. */
  prefixSkip?: number;
  /** Pace a synchronous accumulator replay instead of painting it at once.
   *  Used by the Reasoning block, which mounts on the first thought chunk. */
  paceReplay?: boolean;
}

export function StreamingMarkdown({
  turnId,
  kind,
  className,
  cwd,
  prefixSkip = 0,
  paceReplay = false,
}: Props) {
  const [contextLink, setContextLink] = useState<{
    url: string;
    label?: string;
  } | null>(null);
  // Stash cwd in a ref so the click handler always sees the latest
  // value without forcing the parser to remount when cwd changes mid-
  // stream (which would lose all the DOM mutations and reset the chat
  // visual).
  const cwdRef = useRef<string | null>(cwd ?? null);
  cwdRef.current = cwd ?? null;

  const onLinkActivate = useCallback((url: string) => {
    const target = resolveMarkdownLinkTarget(url, cwdRef.current);
    if (target.kind === "http") {
      openBrowserAwareUrl(target.url);
    } else if (target.kind === "file") {
      void previewLocalFile(target.path);
    }
  }, []);

  const decorateLinks = useCallback((nodes: readonly Element[]) => {
    for (const root of nodes) {
      decorateStreamingHttpLinks(root);
      const selector = "a:not([data-markdown-file-link])";
      for (const anchor of [
        ...(root.matches(selector) ? [root as HTMLAnchorElement] : []),
        ...root.querySelectorAll<HTMLAnchorElement>(selector),
      ]) {
        const target = resolveMarkdownLinkTarget(anchor.getAttribute("href") ?? "", cwdRef.current);
        if (target.kind !== "file") continue;
        anchor.dataset.markdownFileLink = "true";
        anchor.classList.add("markdown-local-file-link");
        anchor.title = target.path;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("fill", "none");
        icon.setAttribute("stroke", "currentColor");
        icon.setAttribute("stroke-width", "2");
        icon.setAttribute("aria-hidden", "true");
        icon.setAttribute("class", "mr-1 inline-block size-3.5 align-text-bottom");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h6");
        icon.append(path);
        anchor.prepend(icon);
      }
    }
  }, []);

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a") as HTMLAnchorElement | null;
    const url = (anchor?.getAttribute("href") ?? "").trim();
    if (!anchor || !/^https?:\/\//i.test(url)) {
      event.preventDefault();
      return;
    }
    setContextLink({ url, label: anchor.textContent?.trim() || undefined });
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div onContextMenu={onContextMenu}>
          <AgentUIStreamingMarkdown
            store={sessionStore}
            turnId={turnId}
            kind={kind}
            prefixSkip={prefixSkip}
            paceReplay={paceReplay}
            onLinkActivate={onLinkActivate}
            decorateNodes={decorateLinks}
            className={cn(
              MARKDOWN_PROSE_TYPE,
              MARKDOWN_BLOCK_RHYTHM,
              className,
            )}
          />
        </div>
      </ContextMenu.Trigger>
      {contextLink && (
        <MarkdownLinkMenuContent
          url={contextLink.url}
          label={contextLink.label}
        />
      )}
    </ContextMenu.Root>
  );
}
