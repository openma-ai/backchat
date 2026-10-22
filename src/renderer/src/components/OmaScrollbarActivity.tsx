import { useEffect } from "react";
import {
  clearOmaScrollbarScrolling,
  isOmaScrollbarElement,
  markOmaScrollbarScrolling,
  OMA_SCROLLBAR_IDLE_MS,
} from "@/lib/oma-scrollbar-activity";

/** Scroll-capture reveal for native overlay scrollbars (transcript parity). */
export function OmaScrollbarActivity() {
  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !isOmaScrollbarElement(target)) {
        return;
      }
      const previous = timers.get(target);
      if (previous !== undefined) clearTimeout(previous);
      markOmaScrollbarScrolling(target);
      timers.set(
        target,
        setTimeout(() => {
          clearOmaScrollbarScrolling(target);
          timers.delete(target);
        }, OMA_SCROLLBAR_IDLE_MS),
      );
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return null;
}
