import type { ComponentProps } from "react";
import { GroupedCommandMenu } from "./grouped-command-menu";

/** The project picker is the visual and interaction contract for footer selects. */
export function ComposerPickerMenu(props: Omit<ComponentProps<typeof GroupedCommandMenu>,
  "density" | "shrinkToContent" | "nativeListScroll" | "panelClassName" | "commandClassName" | "insideDropdownMenu">) {
  return <GroupedCommandMenu
    {...props}
    density="comfortable"
    shrinkToContent
    nativeListScroll
    panelClassName="flex h-auto w-full flex-col overflow-hidden p-0"
    commandClassName="rounded-xl! bg-popover p-1! text-popover-foreground border-0! shadow-none ring-0"
  />;
}
