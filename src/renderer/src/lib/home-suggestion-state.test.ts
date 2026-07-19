import { describe, expect, it } from "vitest";

import {
  initialHomeSuggestionState,
  reduceHomeSuggestionState,
} from "./home-suggestion-state";

const selection = {
  kind: "shape" as const,
  label: "Help me shape",
};

describe("home suggestion state", () => {
  it("opens a selected suggestion and records its editable prefix", () => {
    const selected = reduceHomeSuggestionState(
      initialHomeSuggestionState,
      { type: "select", selection },
    );
    const filled = reduceHomeSuggestionState(selected, {
      type: "fill-prefix",
      id: 10,
      text: "Help me shape",
    });

    expect(filled).toEqual({
      phase: "choosing",
      selection,
      selectedPrompt: null,
      draft: { id: 10, text: "Help me shape" },
    });
  });

  it("atomically replaces a choice with an editable template", () => {
    const selected = reduceHomeSuggestionState(
      initialHomeSuggestionState,
      { type: "select", selection },
    );

    expect(reduceHomeSuggestionState(selected, {
      type: "template-selected",
      id: 11,
      slotLabel: "idea",
      template: {
        before: "Help me shape ",
        slotLabel: "idea",
        after: " into a plan",
      },
    })).toEqual({
      phase: "dismissed",
      selection: null,
      selectedPrompt: "idea",
      draft: {
        id: 11,
        text: "",
        template: {
          before: "Help me shape ",
          slotLabel: "idea",
          after: " into a plan",
        },
      },
    });
  });

  it("clears active choices when the user types or returns", () => {
    const choosing = {
      ...initialHomeSuggestionState,
      phase: "choosing" as const,
      selection,
      selectedPrompt: "idea",
    };

    expect(reduceHomeSuggestionState(choosing, {
      type: "user-input",
      hasContent: true,
    })).toMatchObject({
      phase: "dismissed",
      selection: null,
      selectedPrompt: null,
    });
    expect(reduceHomeSuggestionState(choosing, {
      type: "back",
    })).toMatchObject({
      phase: "visible",
      selection: null,
      selectedPrompt: null,
    });
  });

  it("consumes only the draft on submit and re-baselines visible choices on session change", () => {
    const active = {
      phase: "dismissed" as const,
      selection,
      selectedPrompt: "idea",
      draft: { id: 12, text: "draft" },
    };

    expect(reduceHomeSuggestionState(active, { type: "consume" }))
      .toEqual({ ...active, draft: null });
    expect(reduceHomeSuggestionState(active, { type: "reset" }))
      .toEqual({
        ...active,
        phase: "visible",
        selection: null,
        selectedPrompt: null,
      });
  });
});
