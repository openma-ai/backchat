import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
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
}: AnimatedCollapseProps) {
  return (
    <div
      data-slot="animated-collapse"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={cn("animated-collapse", className)}
    >
      <div className="animated-collapse-inner">{children}</div>
    </div>
  );
}
