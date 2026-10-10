import { cn } from "@/lib/utils";

/** Footer popover/dropdown chips (host / project / workspace). Open-state visuals
 *  live in `.app-compact-control` CSS so pointer-open matches keyboard-open. */
export function composerFooterTriggerClass(...extra: Array<string | undefined>) {
  return cn("app-compact-control min-w-0", ...extra);
}
