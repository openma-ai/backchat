import { GlobeIcon } from "lucide-react";
import { useState } from "react";

export function markdownLinkFaviconUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return null;
    return new URL("/favicon.ico", url.origin).href;
  } catch {
    return null;
  }
}

export function MarkdownLinkFavicon({ url }: { url: string }) {
  const src = markdownLinkFaviconUrl(url);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <GlobeIcon
        className="mr-1 inline size-3 align-[-1px] text-info/70"
        data-markdown-link-favicon-fallback="true"
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={12}
      height={12}
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="mr-1 inline size-3 rounded-[2px] object-contain align-[-1px]"
      data-markdown-link-favicon="true"
      aria-hidden="true"
    />
  );
}

/** Adds the same favicon treatment to the DOM-only streaming renderer. */
export function decorateStreamingHttpLinks(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    "a:not([data-markdown-http-link])",
  )) {
    const url = (anchor.getAttribute("href") ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    anchor.dataset.markdownHttpLink = "true";
    const src = markdownLinkFaviconUrl(url);
    if (!src) continue;
    const favicon = document.createElement("img");
    favicon.src = src;
    favicon.alt = "";
    favicon.width = 12;
    favicon.height = 12;
    favicon.loading = "lazy";
    favicon.referrerPolicy = "no-referrer";
    favicon.draggable = false;
    favicon.className =
      "mr-1 inline size-3 rounded-[2px] object-contain align-[-1px]";
    favicon.dataset.markdownLinkFavicon = "true";
    favicon.setAttribute("aria-hidden", "true");
    favicon.addEventListener("error", () => favicon.remove(), { once: true });
    anchor.prepend(favicon);
  }
}
