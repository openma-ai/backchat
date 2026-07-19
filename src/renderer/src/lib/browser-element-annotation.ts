import type {
  BrowserElementAnnotationDetails,
  BrowserRegionAnnotationDetails,
  PromptAnnotation,
} from "@shared/session-events.js";
import { numberPromptAnnotations } from "./prompt-annotations";

export type BrowserElementPick = Omit<
  BrowserElementAnnotationDetails,
  "screenshot_name"
>;

export type BrowserRegionPick = Omit<
  BrowserRegionAnnotationDetails,
  "screenshot_name"
>;

export const BROWSER_STYLE_PROPERTIES = [
  "color",
  "background",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "border-radius",
] as const;

export type BrowserStyleProperty = typeof BROWSER_STYLE_PROPERTIES[number];
export type BrowserStyleDraft = Record<BrowserStyleProperty, string>;

export function browserStyleDraft(
  element: BrowserElementPick,
): BrowserStyleDraft {
  const draft = Object.fromEntries(
    BROWSER_STYLE_PROPERTIES.map((property) => [
      property,
      element.computed_styles?.[property] ?? "",
    ]),
  ) as BrowserStyleDraft;
  for (const change of element.style_changes ?? []) {
    if (BROWSER_STYLE_PROPERTIES.includes(change.property as BrowserStyleProperty)) {
      draft[change.property as BrowserStyleProperty] = change.to;
    }
  }
  return draft;
}

export function browserStyleChanges(
  element: BrowserElementPick,
  draft: BrowserStyleDraft,
): NonNullable<BrowserElementAnnotationDetails["style_changes"]> {
  return BROWSER_STYLE_PROPERTIES.flatMap((property) => {
    const from = element.computed_styles?.[property] ?? "";
    const to = draft[property].trim();
    return to && to !== from ? [{ property, from, to }] : [];
  });
}

export type BrowserAnnotationGesture =
  | { kind: "element" }
  | {
      kind: "region";
      rect: { x: number; y: number; width: number; height: number };
    };

export function browserAnnotationGesture(
  start: { x: number; y: number },
  end: { x: number; y: number },
  dragThreshold = 6,
): BrowserAnnotationGesture {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) < dragThreshold) return { kind: "element" };
  return {
    kind: "region",
    rect: {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    },
  };
}

export function browserElementAnnotationLabel(pick: BrowserElementPick): string {
  const text = pick.text?.replace(/\s+/g, " ").trim();
  const shortText = text && text.length > 80 ? `${text.slice(0, 79)}...` : text;
  return shortText ? `${pick.selector} — ${shortText}` : pick.selector;
}

export function browserElementScreenshotName(pick: BrowserElementPick): string {
  const tag = pick.tag_name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "element";
  return `page-element-${tag}-${Date.now()}.png`;
}

export function browserRegionAnnotationLabel(region: BrowserRegionPick): string {
  return `Region ${Math.round(region.rect.width)}x${Math.round(region.rect.height)}`;
}

export function browserRegionScreenshotName(): string {
  return `page-region-${Date.now()}.png`;
}

export function buildBrowserElementPromptAnnotation(input: {
  id: string;
  sessionId: string;
  element: BrowserElementPick;
  screenshotName: string;
}): PromptAnnotation {
  return {
    id: input.id,
    kind: "browser_element",
    source_session_id: input.sessionId,
    source_turn_id: "browser",
    text: browserElementAnnotationLabel(input.element),
    browser: {
      ...input.element,
      screenshot_name: input.screenshotName,
    },
  };
}

export function buildBrowserRegionPromptAnnotation(input: {
  id: string;
  sessionId: string;
  region: BrowserRegionPick;
  screenshotName: string;
}): PromptAnnotation {
  return {
    id: input.id,
    kind: "browser_region",
    source_session_id: input.sessionId,
    source_turn_id: "browser",
    text: browserRegionAnnotationLabel(input.region),
    browser_region: {
      ...input.region,
      screenshot_name: input.screenshotName,
    },
  };
}

export function isBrowserPageAnnotation(
  annotation: PromptAnnotation,
): boolean {
  return (
    (annotation.kind === "browser_element" && !!annotation.browser)
    || (annotation.kind === "browser_region" && !!annotation.browser_region)
  );
}

export function browserAnnotationScreenshotName(
  annotation: PromptAnnotation,
): string | null {
  if (annotation.kind === "browser_element") {
    return annotation.browser?.screenshot_name ?? null;
  }
  if (annotation.kind === "browser_region") {
    return annotation.browser_region?.screenshot_name ?? null;
  }
  return null;
}

export interface BrowserAnnotationMarker {
  annotation: PromptAnnotation;
  index: number;
  kind: "element" | "region";
  rect: { x: number; y: number; width: number; height: number };
}

export function browserAnnotationMarkers(
  annotations: PromptAnnotation[],
  currentUrl: string,
): BrowserAnnotationMarker[] {
  const pageKey = browserPageKey(currentUrl);
  if (!pageKey) return [];
  const markers: BrowserAnnotationMarker[] = [];
  numberPromptAnnotations(annotations).forEach(({ annotation, index }) => {
    if (annotation.kind === "browser_element" && annotation.browser) {
      if (browserPageKey(annotation.browser.url) === pageKey) {
        markers.push({
          annotation,
          index,
          kind: "element",
          rect: annotation.browser.rect,
        });
      }
      return;
    }
    if (annotation.kind === "browser_region" && annotation.browser_region) {
      if (browserPageKey(annotation.browser_region.url) === pageKey) {
        markers.push({
          annotation,
          index,
          kind: "region",
          rect: annotation.browser_region.rect,
        });
      }
    }
  });
  return markers;
}

function browserPageKey(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
