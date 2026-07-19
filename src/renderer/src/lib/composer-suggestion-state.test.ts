import { describe, expect, it } from "vitest";

import {
  composerSuggestionFillDuration,
  composerSuggestionFillLength,
} from "./composer-suggestion-state";

describe("composer suggestion fill", () => {
  it("scales animation duration with prompt length inside the product bounds", () => {
    expect(composerSuggestionFillDuration(0)).toBe(320);
    expect(composerSuggestionFillDuration(10)).toBe(320);
    expect(composerSuggestionFillDuration(40)).toBe(480);
    expect(composerSuggestionFillDuration(100)).toBe(680);
  });

  it("uses the existing ease-out curve while keeping the visible slice valid", () => {
    expect(composerSuggestionFillLength(10, 0, 400)).toBe(1);
    expect(composerSuggestionFillLength(10, 200, 400)).toBe(9);
    expect(composerSuggestionFillLength(10, 400, 400)).toBe(10);
    expect(composerSuggestionFillLength(10, 800, 400)).toBe(10);
  });
});
