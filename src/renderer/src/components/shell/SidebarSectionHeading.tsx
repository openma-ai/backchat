import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { ChevronRightIcon } from "@/components/Icons";
import { cn } from "@/lib/utils";
import {
  SidebarGridCell,
  SidebarGridRow,
  type SidebarGridDepth,
} from "@/components/shell/SidebarGridRow";

type SidebarSectionHeadingProps = {
  title: string;
  open: boolean;
  onToggle?: () => void;
  labelCls?: string;
  action?: ReactNode;
  icon?: ReactNode;
  depth?: SidebarGridDepth;
  className?: string;
  trigger?: boolean;
  headingSize?: "default" | "compact";
  showDisclosure?: boolean;
  "data-testid"?: string;
} & Omit<React.ComponentPropsWithoutRef<"button">, "children" | "className" | "type">;

export const SidebarSectionHeading = forwardRef<
  HTMLButtonElement,
  SidebarSectionHeadingProps
>(function SidebarSectionHeading(
  {
    title,
    open,
    onToggle,
    labelCls = "",
    action,
    icon,
    depth = 0,
    className,
    trigger = false,
    headingSize = "default",
    showDisclosure = true,
    ...rowProps
  },
  ref,
) {
  const heading = (
    <>
      {icon ? (
        <SidebarGridCell slot="icon">
          <span className="sidebar-row-icon">{icon}</span>
        </SidebarGridCell>
      ) : null}
      <SidebarGridCell slot="label">
        {trigger ? (
          <span className={cn("min-w-0 truncate", labelCls)}>
            {title}
          </span>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label={title}
            aria-expanded={open}
            className={cn(
              "app-no-drag flex h-full min-w-0 flex-1 items-center gap-1 text-left",
              headingSize === "compact"
                ? "sidebar-section-heading-compact font-medium"
                : "sidebar-section-heading font-normal",
              "text-fg-muted",
              "transition-colors duration-[var(--dur-quick)] ease-[var(--ease-snap)]",
            )}
          >
            <span className={cn("min-w-0 truncate", labelCls)}>{title}</span>
            {showDisclosure ? (
              <span className={cn("inline-flex shrink-0", labelCls)}>
                <ChevronRightIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3 transition-transform duration-[var(--motion-disclosure-duration)] ease-[var(--motion-disclosure-easing)]",
                    open && "rotate-90",
                    open &&
                      "opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100",
                  )}
                />
              </span>
            ) : null}
          </button>
        )}
      </SidebarGridCell>
      {action ? (
        <SidebarGridCell
          slot="trailing"
          className={cn(
            labelCls.split(/\s+/).includes("hidden") && "hidden",
            "opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100",
          )}
          data-sidebar-section-header-action="true"
        >
          {action}
        </SidebarGridCell>
      ) : null}
    </>
  );
  const rowClassName = cn(
    "sidebar-section-header group/section rounded-md transition-colors",
    className,
  );

  if (trigger) {
    return (
      <button
        {...rowProps}
        ref={ref}
        type="button"
        className={cn(
          "sidebar-grid-row w-full text-xs font-medium text-fg-muted",
          rowClassName,
        )}
        data-sidebar-depth={depth}
        data-sidebar-trailing-track="none"
        data-sidebar-leading="none"
        style={{ "--sidebar-depth": depth } as CSSProperties}
      >
        {heading}
      </button>
    );
  }

  return (
    <SidebarGridRow
      {...(rowProps as React.ComponentProps<"div">)}
      depth={depth}
      trailingTrack={action ? "double" : "none"}
      leading={icon ? "icon" : "none"}
      className={rowClassName}
    >
      {heading}
    </SidebarGridRow>
  );
});
