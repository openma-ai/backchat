import { describe, expect, it, vi } from "vitest";

import {
  browserAnnotationGesture,
  browserAnnotationMarkers,
  browserAnnotationScreenshotName,
  browserElementAnnotationLabel,
  browserElementScreenshotName,
  browserStyleChanges,
  browserStyleDraft,
  isBrowserPageAnnotation,
  browserRegionAnnotationLabel,
  browserRegionScreenshotName,
  type BrowserElementPick,
} from "./browser-element-annotation";

const pick: BrowserElementPick = {
  url: "https://example.test",
  title: "Example",
  selector: "#save",
  tag_name: "button",
  class_names: ["primary"],
  text: "Save settings",
  attributes: { type: "button" },
  rect: { x: 1, y: 2, width: 100, height: 40 },
  viewport: { width: 1200, height: 800, device_pixel_ratio: 2 },
};

describe("browser element annotations", () => {
  it("builds a compact visible label", () => {
    expect(browserElementAnnotationLabel(pick)).toBe("#save — Save settings");
  });

  it("uses a stable, PNG screenshot name", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    expect(browserElementScreenshotName(pick)).toBe("page-element-button-1234.png");
    vi.restoreAllMocks();
  });

  it("turns edited style fields into before/after annotation changes", () => {
    const styledPick: BrowserElementPick = {
      ...pick,
      computed_styles: {
        color: "rgb(15, 17, 21)",
        background: "rgb(255, 255, 255)",
        opacity: "1",
        "font-family": "Inter, sans-serif",
        "font-size": "14px",
        "font-weight": "600",
      },
    };
    const draft = browserStyleDraft(styledPick);
    draft.opacity = "0.8";
    draft["font-size"] = "16px";

    expect(browserStyleChanges(styledPick, draft)).toEqual([
      { property: "opacity", from: "1", to: "0.8" },
      { property: "font-size", from: "14px", to: "16px" },
    ]);
  });

  it("labels and names a browser region independently from an element", () => {
    vi.spyOn(Date, "now").mockReturnValue(5678);
    const region = {
      url: "https://example.test",
      title: "Example",
      rect: { x: 20, y: 30, width: 200, height: 100 },
      viewport: { width: 1200, height: 800, device_pixel_ratio: 2 },
    };
    expect(browserRegionAnnotationLabel(region)).toBe("Region 200x100");
    expect(browserRegionScreenshotName()).toBe("page-region-5678.png");
    vi.restoreAllMocks();
  });

  it("treats both DOM elements and freeform regions as screenshot-backed page annotations", () => {
    const element = {
      id: "element-1",
      kind: "browser_element" as const,
      source_session_id: "session-1",
      source_turn_id: "browser",
      text: "#save",
      browser: { ...pick, screenshot_name: "element.png" },
    };
    const region = {
      id: "region-1",
      kind: "browser_region" as const,
      source_session_id: "session-1",
      source_turn_id: "browser",
      text: "Region 200x100",
      browser_region: {
        url: "https://example.test",
        title: "Example",
        rect: { x: 20, y: 30, width: 200, height: 100 },
        viewport: { width: 1200, height: 800, device_pixel_ratio: 2 },
        screenshot_name: "region.png",
      },
    };
    const response = {
      id: "response-1",
      source_session_id: "session-1",
      source_turn_id: "turn-1",
      text: "selected response text",
    };

    expect(isBrowserPageAnnotation(element)).toBe(true);
    expect(isBrowserPageAnnotation(region)).toBe(true);
    expect(isBrowserPageAnnotation(response)).toBe(false);
    expect(browserAnnotationScreenshotName(element)).toBe("element.png");
    expect(browserAnnotationScreenshotName(region)).toBe("region.png");
    expect(browserAnnotationScreenshotName(response)).toBeNull();
  });

  it("treats a steady pointer as an element click", () => {
    expect(
      browserAnnotationGesture({ x: 100, y: 120 }, { x: 104, y: 123 }),
    ).toEqual({ kind: "element" });
  });

  it("normalizes a drag in any direction into a viewport region", () => {
    expect(
      browserAnnotationGesture({ x: 420, y: 360 }, { x: 180, y: 140 }),
    ).toEqual({
      kind: "region",
      rect: { x: 180, y: 140, width: 240, height: 220 },
    });
  });

  it("keeps page markers on the matching URL with composer-global numbering", () => {
    const response = {
      id: "response-1",
      source_session_id: "session-1",
      source_turn_id: "turn-1",
      text: "selected response text",
    };
    const element = {
      id: "element-1",
      kind: "browser_element" as const,
      source_session_id: "session-1",
      source_turn_id: "browser",
      text: "#save",
      browser: { ...pick, url: "https://example.test/settings#details", screenshot_name: "element.png" },
    };
    const region = {
      id: "region-1",
      kind: "browser_region" as const,
      source_session_id: "session-1",
      source_turn_id: "browser",
      text: "Region 200x100",
      browser_region: {
        url: "https://other.test/",
        title: "Other",
        rect: { x: 20, y: 30, width: 200, height: 100 },
        viewport: { width: 1200, height: 800, device_pixel_ratio: 2 },
        screenshot_name: "region.png",
      },
    };

    expect(
      browserAnnotationMarkers(
        [response, element, region],
        "https://example.test/settings",
      ),
    ).toEqual([
      {
        annotation: element,
        index: 2,
        kind: "element",
        rect: pick.rect,
      },
    ]);
  });
});
