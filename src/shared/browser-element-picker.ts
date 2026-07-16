import type {
  BrowserElementAnnotationDetails,
  BrowserRegionAnnotationDetails,
} from "./session-events.js";

export interface BrowserElementHoverInfo {
  selector: string;
  tag_name: string;
  rect: { x: number; y: number; width: number; height: number };
  label: string;
}

export interface BrowserElementPickResult {
  element: Omit<BrowserElementAnnotationDetails, "screenshot_name">;
  screenshotData: string;
}

export interface BrowserRegionPickResult {
  region: Omit<BrowserRegionAnnotationDetails, "screenshot_name">;
  screenshotData: string;
}
