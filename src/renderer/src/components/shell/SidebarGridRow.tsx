import * as React from "react";
import { cn } from "@/lib/utils";

export type SidebarGridDepth = 0 | 1 | 2 | 3;
export type SidebarGridTrailingTrack = "single" | "double" | "host";

export function sidebarGridRowClassName({
  depth = 0,
  trailingTrack = "single",
  className,
}: {
  depth?: SidebarGridDepth;
  trailingTrack?: SidebarGridTrailingTrack;
  className?: string;
}) {
  return cn("sidebar-grid-row", className);
}

export function sidebarGridRowProps({
  depth = 0,
  trailingTrack = "single",
}: {
  depth?: SidebarGridDepth;
  trailingTrack?: SidebarGridTrailingTrack;
} = {}) {
  return {
    "data-sidebar-depth": String(depth),
    "data-sidebar-trailing-track": trailingTrack,
  } as const;
}

export function SidebarGridRow({
  depth = 0,
  trailingTrack = "single",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  depth?: SidebarGridDepth;
  trailingTrack?: SidebarGridTrailingTrack;
}) {
  return (
    <div
      className={sidebarGridRowClassName({ depth, trailingTrack, className })}
      {...sidebarGridRowProps({ depth, trailingTrack })}
      {...props}
    />
  );
}

export function SidebarGridCell({
  slot,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  slot: "icon" | "label" | "trailing";
}) {
  return (
    <span
      data-sidebar-grid={slot}
      className={cn(
        slot === "icon" && "sidebar-grid-cell-icon",
        slot === "label" && "sidebar-grid-cell-label",
        slot === "trailing" && "sidebar-grid-cell-trailing",
        className,
      )}
      {...props}
    />
  );
}
