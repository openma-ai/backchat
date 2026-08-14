import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

import { cn } from "@/lib/utils";

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface ScrollFadeState {
  top: boolean;
  bottom: boolean;
}

const EDGE_TOLERANCE_PX = 1;

export function scrollFadeState({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ScrollMetrics): ScrollFadeState {
  const overflow = scrollHeight - clientHeight;
  if (overflow <= EDGE_TOLERANCE_PX) {
    return { top: false, bottom: false };
  }
  return {
    top: scrollTop > EDGE_TOLERANCE_PX,
    bottom: scrollTop < overflow - EDGE_TOLERANCE_PX,
  };
}

/**
 * A bounded activity scroller that follows new content until the user scrolls
 * away. Each instance owns its handoff state, so nested timelines cannot take
 * over the conversation scroller or one another.
 */
export function FadeScrollViewport({
  children,
  level,
  className,
  contentClassName,
}: {
  children: ReactNode;
  level: "primary" | "secondary";
  className?: string;
  contentClassName?: string;
}) {
  const stick = useStickToBottom({ initial: "auto", resize: "auto" });
  const [fades, setFades] = useState<ScrollFadeState>({
    top: false,
    bottom: false,
  });

  const updateFades = useCallback(() => {
    const element = stick.scrollRef.current;
    if (!element) return;
    setFades(scrollFadeState(element));
  }, [stick.scrollRef]);

  useEffect(() => {
    const scrollElement = stick.scrollRef.current;
    const contentElement = stick.contentRef.current;
    if (!scrollElement) return;

    updateFades();
    const observer = new ResizeObserver(updateFades);
    observer.observe(scrollElement);
    if (contentElement) observer.observe(contentElement);
    scrollElement.addEventListener("scroll", updateFades, { passive: true });

    return () => {
      observer.disconnect();
      scrollElement.removeEventListener("scroll", updateFades);
    };
  }, [stick.contentRef, stick.scrollRef, updateFades]);

  useEffect(updateFades, [children, stick.isAtBottom, updateFades]);

  return (
    <div
      className={cn("activity-timeline-viewport", className)}
      data-fade-scroll-viewport={level}
    >
      <div
        ref={stick.scrollRef}
        className="activity-timeline-scroller"
        onScroll={updateFades}
      >
        <div ref={stick.contentRef} className={contentClassName}>
          {children}
        </div>
      </div>
      <span
        className="activity-scroll-fade activity-scroll-fade-top"
        data-scroll-fade="top"
        data-visible={fades.top}
        aria-hidden="true"
      />
      <span
        className="activity-scroll-fade activity-scroll-fade-bottom"
        data-scroll-fade="bottom"
        data-visible={fades.bottom}
        aria-hidden="true"
      />
    </div>
  );
}
