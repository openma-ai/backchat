import { cn } from "@/lib/utils";

/** Highlight sweep across label text (harness probe, loading copy). */
export function ShimmerText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("shimmer-text", className)}>{children}</span>;
}
