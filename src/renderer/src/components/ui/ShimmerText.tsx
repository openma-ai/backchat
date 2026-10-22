import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Highlight sweep across label text (harness probe, loading copy). */
export function ShimmerText({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn("shimmer-text", className)} />;
}
