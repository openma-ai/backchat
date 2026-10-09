import type * as React from "react";
import {
  SidebarGridCell,
  SidebarGridRow,
  type SidebarGridTrailingTrack,
} from "@/components/shell/SidebarGridRow";
import { cn } from "@/lib/utils";

/** Composer / run-menu rows: same icon | label | trailing mesh as the sidebar. */
export function SelectMenuGridRow({
  trailingTrack = "single",
  className,
  children,
  ...props
}: React.ComponentProps<typeof SidebarGridRow>) {
  return (
    <SidebarGridRow
      depth={0}
      trailingTrack={trailingTrack}
      className={cn(
        "min-h-10 h-auto py-1.5 px-2 [--sidebar-content-padding-inline-start:0px] [--sidebar-content-padding-inline-end:0px]",
        className,
      )}
      {...props}
    >
      {children}
    </SidebarGridRow>
  );
}

export { SidebarGridCell };
export type { SidebarGridTrailingTrack };
