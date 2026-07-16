import { beforeEach, describe, expect, it } from "vitest";

import type { PromptAnnotation } from "@shared/session-events.js";
import * as promptAnnotations from "./prompt-annotations";
import { promptAnnotationStore } from "./prompt-annotations";

const annotation = {
  id: "annotation-1",
  source_session_id: "sess-source",
  source_turn_id: "turn-source",
  text: "Selected response text",
};

describe("promptAnnotationStore", () => {
  beforeEach(() => promptAnnotationStore.resetForTests());

  it("keeps annotation drafts isolated by destination session", () => {
    promptAnnotationStore.add("sess-main", annotation);

    expect(promptAnnotationStore.get("sess-main")).toEqual([annotation]);
    expect(promptAnnotationStore.get("side-chat")).toEqual([]);
  });

  it("updates comments without duplicating annotations", () => {
    promptAnnotationStore.add("sess-main", annotation);
    promptAnnotationStore.add("sess-main", {
      ...annotation,
      comment: "Use a concrete example.",
    });
    promptAnnotationStore.update("sess-main", annotation.id, {
      comment: "Explain this in more detail.",
    });

    expect(promptAnnotationStore.get("sess-main")).toEqual([
      {
        ...annotation,
        comment: "Explain this in more detail.",
      },
    ]);
  });

  it("removes one annotation and clears only the requested session", () => {
    promptAnnotationStore.add("sess-main", annotation);
    promptAnnotationStore.add("side-chat", { ...annotation, id: "annotation-2" });

    promptAnnotationStore.remove("sess-main", annotation.id);
    expect(promptAnnotationStore.get("sess-main")).toEqual([]);

    promptAnnotationStore.clear("side-chat");
    expect(promptAnnotationStore.get("side-chat")).toEqual([]);
  });
});

describe("numberPromptAnnotations", () => {
  it("shares one sequence across response, element, and region annotations", () => {
    const annotations: PromptAnnotation[] = [
      {
        id: "response-1",
        kind: "response",
        source_session_id: "sess-main",
        source_turn_id: "turn-1",
        text: "Selected response text",
      },
      {
        id: "element-1",
        kind: "browser_element",
        source_session_id: "sess-main",
        source_turn_id: "browser:tab-1",
        text: "#save",
      },
      {
        id: "region-1",
        kind: "browser_region",
        source_session_id: "sess-main",
        source_turn_id: "browser:tab-1",
        text: "Region 200x100",
      },
    ];
    const numberPromptAnnotations = (
      promptAnnotations as typeof promptAnnotations & {
        numberPromptAnnotations: (
          values: PromptAnnotation[],
        ) => Array<{ annotation: PromptAnnotation; index: number }>;
      }
    ).numberPromptAnnotations;

    expect(numberPromptAnnotations(annotations)).toEqual([
      { annotation: annotations[0], index: 1 },
      { annotation: annotations[1], index: 2 },
      { annotation: annotations[2], index: 3 },
    ]);
  });
});
