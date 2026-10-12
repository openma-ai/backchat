import { cn } from "@/lib/utils";

export function composerFooterTriggerClass(...extra: Array<string | undefined>) {
  return cn("composer-footer-trigger", ...extra);
}

export function composerFooterTriggerProps(openSurface: "filled" | "none" = "filled") {
  return { "data-open-surface": openSurface === "none" ? "none" : undefined };
}
