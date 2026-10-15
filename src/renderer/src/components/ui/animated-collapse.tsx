import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** Defer the body until the first open, then keep it mounted. The shell is
   *  always rendered at 0fr, so even that first open animates. */
  lazy?: boolean;
}

/**
 * Keeps disclosure content mounted while animating its intrinsic height.
 * Motion values live in the shared CSS tokens, so every disclosure has the
 * same timing and automatically follows the reduced-motion preference.
 */
export function AnimatedCollapse({
  open,
  children,
  className,
  lazy = false,
}: AnimatedCollapseProps) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return (
    <div
      data-slot="animated-collapse"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={cn("animated-collapse", className)}
    >
      <div className="animated-collapse-inner">{!lazy || opened ? children : null}</div>
    </div>
  );
}
