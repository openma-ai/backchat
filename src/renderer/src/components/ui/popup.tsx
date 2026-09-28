import type { ComponentProps } from "react";
import { DialogContent, DialogHeader } from "./dialog";
import { ScrollArea } from "./scroll-area";
import { cn } from "@/lib/utils";

/** Cmd K's stable top anchor and surface, shared by basic application popups. */
export function PopupContent({
  className,
  showCloseButton = false,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      {...props}
      showCloseButton={showCloseButton}
      className={cn(
        "!top-[18vh] !translate-y-0 !max-w-xl max-h-[calc(82dvh-16px)] gap-0 overflow-hidden p-0",
        className,
      )}
    />
  );
}
export function PopupHeader({
  className,
  ...props
}: ComponentProps<typeof DialogHeader>) {
  return (
    <DialogHeader
      {...props}
      className={cn("px-5 pb-4 pt-5 pr-12", className)}
    />
  );
}
export function PopupBody({
  className,
  ...props
}: ComponentProps<typeof ScrollArea>) {
  return (
    <ScrollArea
      {...props}
      className={cn(
        "min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]]:max-h-[calc(82dvh-220px)]",
        className,
      )}
    />
  );
}
