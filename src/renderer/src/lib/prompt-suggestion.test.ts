import { describe, expect, it } from "vitest";

import {
  readPromptSuggestion,
  resolvePromptSuggestionGhost,
} from "./prompt-suggestion";

describe("readPromptSuggestion", () => {
  it("reports nothing when the update carries no promptSuggestions key", () => {
    expect(readPromptSuggestion(undefined)).toEqual({ present: false, text: null });
    expect(readPromptSuggestion({ codex: { threadStatus: { type: "idle" } } }))
      .toEqual({ present: false, text: null });
    expect(readPromptSuggestion({ promptSuggestions: undefined }))
      .toEqual({ present: false, text: null });
  });

  it("takes the first non-blank suggestion text", () => {
    expect(readPromptSuggestion({
      promptSuggestions: {
        suggestions: [{ text: "  Run the tests  " }, { text: "Second" }],
      },
    })).toEqual({ present: true, text: "Run the tests" });
  });

  it("clears the suggestion on an empty list", () => {
    expect(readPromptSuggestion({ promptSuggestions: { suggestions: [] } }))
      .toEqual({ present: true, text: null });
  });

  it("treats a list of blank entries as a cleared suggestion", () => {
    expect(readPromptSuggestion({
      promptSuggestions: { suggestions: [{ text: "   " }, { text: "" }] },
    })).toEqual({ present: true, text: null });
    expect(readPromptSuggestion({
      promptSuggestions: { suggestions: [{}, { text: 42 }] },
    })).toEqual({ present: true, text: null });
  });

  it("clears the suggestion when the payload has the wrong shape", () => {
    expect(readPromptSuggestion({ promptSuggestions: null }))
      .toEqual({ present: true, text: null });
    expect(readPromptSuggestion({ promptSuggestions: { suggestions: "nope" } }))
      .toEqual({ present: true, text: null });
  });
});

describe("resolvePromptSuggestionGhost", () => {
  it("shows the suggestion in an empty composer", () => {
    expect(resolvePromptSuggestionGhost({
      text: "",
      suggestion: "Run the tests",
    })).toBe("Run the tests");
  });

  it("hides the ghost as soon as the composer has content", () => {
    expect(resolvePromptSuggestionGhost({
      text: "a",
      suggestion: "Run the tests",
    })).toBeNull();
    // A lone space is the user typing, not an empty composer.
    expect(resolvePromptSuggestionGhost({
      text: " ",
      suggestion: "Run the tests",
    })).toBeNull();
  });

  it("hides the ghost when another surface owns the empty composer", () => {
    expect(resolvePromptSuggestionGhost({
      text: "",
      suggestion: "Run the tests",
      blocked: true,
    })).toBeNull();
  });

  it("keeps the ghost hidden while the dismissed suggestion is current", () => {
    expect(resolvePromptSuggestionGhost({
      text: "",
      suggestion: "Run the tests",
      dismissed: "Run the tests",
    })).toBeNull();
    // A new suggestion is a new string, so it shows again.
    expect(resolvePromptSuggestionGhost({
      text: "",
      suggestion: "Commit the fix",
      dismissed: "Run the tests",
    })).toBe("Commit the fix");
  });

  it("hides the ghost without a suggestion", () => {
    expect(resolvePromptSuggestionGhost({ text: "" })).toBeNull();
    expect(resolvePromptSuggestionGhost({ text: "", suggestion: null })).toBeNull();
    expect(resolvePromptSuggestionGhost({ text: "", suggestion: "  " })).toBeNull();
  });
});
