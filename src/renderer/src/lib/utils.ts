import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn / ai-elements canonical class merger. `clsx` normalizes a mixed
 * argument list (strings, conditionals, arrays, objects); `twMerge` resolves
 * conflicting Tailwind utilities so the LAST one wins
 * (e.g., `cn("p-2", "p-4")` → `"p-4"`).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ScrollAnchorOptions = {
  scrollElement: Pick<HTMLElement, "scrollTop"> | null;
  anchorElement: Pick<HTMLElement, "getBoundingClientRect"> | null;
  contentElement?: Element | null;
  update: () => void;
  stopScroll: () => void;
  scheduleFrame?: (callback: () => void) => void;
};

/** Keep a disclosure trigger at the same viewport Y while its content changes.
 * This counters bottom-pinned chat scrollers reflowing upward when a block near
 * the composer expands or collapses. */
export function preserveScrollAnchor({
  scrollElement,
  anchorElement,
  contentElement,
  update,
  stopScroll,
  scheduleFrame = (callback) => requestAnimationFrame(callback),
}: ScrollAnchorOptions): void {
  if (!scrollElement || !anchorElement) {
    update();
    return;
  }

  stopScroll();
  const before = anchorElement.getBoundingClientRect().top;
  const reanchor = () => {
    const delta = anchorElement.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 0.5) scrollElement.scrollTop += delta;
  };
  if (contentElement && typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() =>
      scheduleFrame(() => {
        stopScroll();
        reanchor();
      }),
    );
    observer.observe(contentElement);
    setTimeout(() => observer.disconnect(), 400);
  }
  update();
  scheduleFrame(reanchor);
}
