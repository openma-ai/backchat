import { describe, expect, it } from "vitest";

import type { PromptAnnotation } from "@shared/session-events.js";
import {
  composerScreenshotNames,
  linkedComposerAnnotationIds,
  removedComposerScreenshotNames,
} from "./composer-context-state";

const responseAnnotation: PromptAnnotation = {
  id: "response-1",
  source_session_id: "session-1",
  source_turn_id: "turn-1",
  text: "Selected response text",
};

function browserAnnotation(
  id: string,
  screenshotName: string,
): PromptAnnotation {
  return {
    id,
    kind: "browser_element",
    source_session_id: "session-1",
    source_turn_id: "browser",
    text: "#save",
    browser: {
      url: "https://example.test",
      title: "Example",
      selector: "#save",
      tag_name: "button",
      class_names: ["primary"],
      attributes: { type: "button" },
      rect: { x: 1, y: 2, width: 100, height: 40 },
      viewport: { width: 1200, height: 800, device_pixel_ratio: 2 },
      screenshot_name: screenshotName,
    },
  };
}

describe("composer context state", () => {
  it("collects only non-empty browser screenshot names", () => {
    expect(composerScreenshotNames([
      responseAnnotation,
      browserAnnotation("browser-1", "element.png"),
      browserAnnotation("browser-2", ""),
      browserAnnotation("browser-3", "element.png"),
    ])).toEqual(new Set(["element.png"]));
  });

  it("finds screenshots that disappeared from the annotation set", () => {
    expect(removedComposerScreenshotNames(
      new Set(["element.png", "shared.png"]),
      new Set(["shared.png", "region.png"]),
    )).toEqual(new Set(["element.png"]));
  });

  it("finds every annotation linked to an attachment screenshot", () => {
    expect(linkedComposerAnnotationIds([
      responseAnnotation,
      browserAnnotation("browser-1", "element.png"),
      browserAnnotation("browser-2", "other.png"),
      browserAnnotation("browser-3", "element.png"),
    ], "element.png")).toEqual(["browser-1", "browser-3"]);
  });
});
