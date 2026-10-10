import { cn } from "@/lib/utils";

/**
 * Border, fill, and resting shadow of the composer card
 * (`.app-composer-surface`) plus its radius (`.composer-radius`).
 * Settings panels use this same string.
 */
export const COMPOSER_BOX_CLASS = "app-composer-surface composer-radius";

/**
 * The composer border and radius without the panel fill, for frames
 * whose interior is a preview. The border declaration is the same
 * rule as `.app-composer-surface`.
 */
export const COMPOSER_FRAME_CLASS = "composer-box-border composer-radius";

export function composerBoxClass(options?: {
  frame?: boolean;
  className?: string;
}): string {
  return cn(
    options?.frame ? COMPOSER_FRAME_CLASS : COMPOSER_BOX_CLASS,
    options?.className,
  );
}
