import { describe, expect, it } from "vitest";

import type { PromptAnnotation } from "@shared/session-events.js";
import * as responseAnnotations from "./ResponseAnnotations";
import {
  annotationAttachment,
  annotationEditorExpanded,
  annotationEditorPosition,
  annotationSummary,
} from "./ResponseAnnotations";

const viewport = { width: 1_000, height: 800 };

describe("annotationEditorPosition", () => {
  it("keeps the comment editor compact and places it to the right when it fits", () => {
    const position = annotationEditorPosition({
      top: 200,
      right: 400,
      bottom: 224,
      left: 200,
      width: 200,
      height: 24,
    }, viewport);

    expect(position.bubbleWidth).toBe(320);
    expect(position.bubbleLeft).toBe(
      position.badgeLeft + 24 + 12,
    );
  });

  it("flips the comment editor to the left when the right side has no room", () => {
    const position = annotationEditorPosition({
      top: 200,
      right: 900,
      bottom: 224,
      left: 600,
      width: 300,
      height: 24,
    }, viewport);

    expect(position.bubbleWidth).toBe(320);
    expect(position.bubbleLeft + position.bubbleWidth).toBe(
      position.badgeLeft - 12,
    );
  });
});

describe("annotationEditorExpanded", () => {
  it("keeps optional detail controls collapsed until their button is pressed", () => {
    expect(annotationEditorExpanded("", true, false)).toBe(false);
    expect(annotationEditorExpanded("", true, true)).toBe(true);
    expect(annotationEditorExpanded("Needs a change", true, false)).toBe(true);
  });
});

describe("annotationSummary", () => {
  it("keeps the exact selector as evidence but renders a concise element identity", () => {
    expect(annotationSummary({
      id: "element-1",
      kind: "browser_element",
      source_session_id: "session-1",
      source_turn_id: "browser",
      text: "textarea#chat-textarea",
      browser: {
        url: "https://example.test/chat",
        title: "Chat",
        selector: "html > body > div.L3eUgb:nth-of-type(2) > textarea#chat-textarea",
        dom_path: "html > body > div > textarea",
        tag_name: "textarea",
        id: "chat-textarea",
        class_names: ["chat-input", "L3eUgb"],
        attributes: {},
        rect: { x: 10, y: 20, width: 240, height: 80 },
        viewport: { width: 440, height: 717, device_pixel_ratio: 2 },
        screenshot_name: "page-element-textarea.png",
      },
    })).toEqual({
      sourceLabel: "Page element",
      primaryText: "textarea#chat-textarea",
      sourceText: "Chat",
      sourceUrl: "https://example.test/chat",
    });
  });

  it("resolves the screenshot attachment owned by a browser annotation", () => {
    const annotation: PromptAnnotation = {
      id: "element-1",
      kind: "browser_element",
      source_session_id: "session-1",
      source_turn_id: "browser",
      text: "textarea#chat-textarea",
      browser: {
        url: "https://example.test/chat",
        title: "Chat",
        selector: "textarea#chat-textarea",
        tag_name: "textarea",
        class_names: [],
        attributes: {},
        rect: { x: 10, y: 20, width: 240, height: 80 },
        viewport: { width: 440, height: 717, device_pixel_ratio: 2 },
        screenshot_name: "page-element-textarea.png",
      },
    };
    const attachment = {
      id: "shot-1",
      name: "page-element-textarea.png",
      path: "/tmp/page-element-textarea.png",
      uri: "file:///tmp/page-element-textarea.png",
      kind: "image" as const,
      mimeType: "image/png",
      data: "iVBORw0KGgo=",
    };

    expect(annotationAttachment(annotation, [attachment])).toEqual(attachment);
  });

  it("renders freeform browser regions as page annotations instead of selected text", () => {
    expect(annotationSummary({
      id: "region-1",
      kind: "browser_region",
      source_session_id: "session-1",
      source_turn_id: "browser",
      text: "Region 260x180",
      browser_region: {
        url: "https://example.test/settings",
        title: "Settings",
        rect: { x: 240, y: 150, width: 260, height: 180 },
        viewport: { width: 1200, height: 800, device_pixel_ratio: 2 },
        screenshot_name: "page-region.png",
      },
    })).toEqual({
      sourceLabel: "Page region",
      primaryText: "Region 260x180",
      sourceText: "Settings",
      sourceUrl: "https://example.test/settings",
    });
  });
});

describe("responseAnnotationMarkers", () => {
  it("keeps the shared ordinal when browser annotations sit between response selections", () => {
    const responseOne: PromptAnnotation = {
      id: "response-1",
      kind: "response",
      source_session_id: "session-1",
      source_turn_id: "turn-1",
      text: "First selection",
    };
    const browser: PromptAnnotation = {
      id: "browser-1",
      kind: "browser_element",
      source_session_id: "session-1",
      source_turn_id: "browser:tab-1",
      text: "#save",
    };
    const responseTwo: PromptAnnotation = {
      id: "response-2",
      kind: "response",
      source_session_id: "session-1",
      source_turn_id: "turn-2",
      text: "Second selection",
    };
    const rangeOne = {} as Range;
    const rangeTwo = {} as Range;
    const rectOne = { top: 10, right: 80, bottom: 30, left: 20, width: 60, height: 20 };
    const rectTwo = { top: 50, right: 140, bottom: 70, left: 90, width: 50, height: 20 };
    const responseAnnotationMarkers = (
      responseAnnotations as typeof responseAnnotations & {
        responseAnnotationMarkers: (
          annotations: PromptAnnotation[],
          ranges: Map<string, Range>,
          rectForRange: (range: Range) => typeof rectOne | null,
        ) => Array<{
          annotation: PromptAnnotation;
          index: number;
          range: Range;
          rect: typeof rectOne;
        }>;
      }
    ).responseAnnotationMarkers;

    expect(responseAnnotationMarkers(
      [responseOne, browser, responseTwo],
      new Map([
        [responseOne.id, rangeOne],
        [responseTwo.id, rangeTwo],
      ]),
      (range) => range === rangeOne ? rectOne : rectTwo,
    )).toEqual([
      { annotation: responseOne, index: 1, range: rangeOne, rect: rectOne },
      { annotation: responseTwo, index: 3, range: rangeTwo, rect: rectTwo },
    ]);
  });
});
