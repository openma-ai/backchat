import * as React from "react";
import { cn } from "@/lib/utils";

export type SidebarGridDepth = 0 | 1 | 2 | 3;
export type SidebarGridTrailingTrack = "none" | "single" | "double" | "host";
export type SidebarGridLeading = "icon" | "none";

export function sidebarGridRowClassName({
  depth = 0,
  trailingTrack = "single",
  leading = "icon",
  className,
}: {
  depth?: SidebarGridDepth;
  trailingTrack?: SidebarGridTrailingTrack;
  leading?: SidebarGridLeading;
  className?: string;
}) {
  return cn("sidebar-grid-row", className);
}

export function sidebarGridRowProps({
  depth = 0,
  trailingTrack = "single",
  leading = "icon",
}: {
  depth?: SidebarGridDepth;
  trailingTrack?: SidebarGridTrailingTrack;
  leading?: SidebarGridLeading;
} = {}) {
  return {
    "data-sidebar-depth": String(depth),
    "data-sidebar-trailing-track": trailingTrack,
    "data-sidebar-leading": leading,
  } as const;
}

type SidebarGridRowCommonProps = {
  depth?: SidebarGridDepth;
  trailingTrack?: SidebarGridTrailingTrack;
  leading?: SidebarGridLeading;
  className?: string;
};

type SidebarGridRowProps =
  | (React.ComponentProps<"div"> & SidebarGridRowCommonProps & { as?: "div" })
  | (React.ComponentProps<"button"> & SidebarGridRowCommonProps & { as: "button" });

export function SidebarGridRow(props: SidebarGridRowProps) {
  const {
    as,
    depth = 0,
    trailingTrack = "single",
    leading = "icon",
    className,
    ...elementProps
  } = props;
  const rowProps = {
    className: sidebarGridRowClassName({ depth, trailingTrack, className }),
    ...sidebarGridRowProps({ depth, trailingTrack, leading }),
    ...elementProps,
  };
  return as === "button" ? (
    <button {...(rowProps as React.ComponentProps<"button">)} />
  ) : (
    <div {...(rowProps as React.ComponentProps<"div">)} />
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
