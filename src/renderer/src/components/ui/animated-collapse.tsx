import { useEffect, useState, type ReactNode, type TransitionEvent } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Kept for existing callers; the body is always deferred until open. */
  lazy?: boolean;
  /** Large sidebar groups skip intrinsic-height interpolation, which otherwise
   *  reflows every descendant on every frame. */
  lightweight?: boolean;
}

/** Upper bound for the close transition (`--motion-disclosure-duration` is
 *  220ms) before the body is dropped even without a transitionend, e.g. under
 *  reduced motion where the duration is 1ms. Read nothing from computed style
 *  here: that forces a style recalc on every toggle. */
const CLOSE_FALLBACK_MS = 400;

/**
 * Disclosure that animates its intrinsic height with the shared motion tokens
 * (and follows reduced motion through them).
 *
 * The body exists only while open or closing: it mounts on open and unmounts
 * when the shell's own close transition ends. A collapsed group therefore
 * costs nothing — no hidden rows, menus or poppers kept alive in the tree.
 */
export function AnimatedCollapse({
  open,
  children,
  className,
  lightweight = false,
}: AnimatedCollapseProps) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  // Unmount after the close transition. transitionend is the signal; the timer
  // covers a transition that never runs (reduced motion, display changes).
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), CLOSE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  const onTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    // Ignore transitions bubbling up from the body.
    const terminalProperty = lightweight ? "opacity" : "height";
    if (event.target === event.currentTarget && !open && event.propertyName === terminalProperty) {
      setMounted(false);
    }
  };

  return (
    <div
      data-slot="animated-collapse"
      data-state={open ? "open" : "closed"}
      data-motion={lightweight ? "lightweight" : undefined}
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={cn("animated-collapse", className)}
      onTransitionEnd={onTransitionEnd}
    >
      <div className="animated-collapse-inner">{mounted ? children : null}</div>
    </div>
  );
}
