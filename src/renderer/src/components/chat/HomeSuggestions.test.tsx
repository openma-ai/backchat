import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string) =>
      ({
        "chat.whatCanIHelp": "What can I help with?",
        "chat.pickDefaultAgent": "Pick an agent",
        "chat.openSettingsChooseAgent": "Choose an agent in Settings",
        "chat.suggestionUnderstand": "Understand",
        "chat.suggestionUnderstandPrompt": "Help me understand",
        "chat.suggestionShape": "Shape",
        "chat.suggestionShapePrompt": "Help me shape",
        "chat.suggestionRefine": "Refine",
        "chat.suggestionRefinePrompt": "Help me improve",
        "chat.suggestionUnblock": "Unblock",
        "chat.suggestionUnblockPrompt": "Help me find a way forward",
        "chat.suggestionBack": "Back",
      })[key] ?? key,
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ themeId: "test-theme", effective: "light" }),
}));

vi.mock("@/themes", () => ({
  getThemePlugin: () => ({
    presentation: {
      homeHero: {
        surface: "flush",
        width: "bleed",
        height: 384,
      },
      homeSlogan: {
        text: "Theme-guided collaboration",
        subtitle: "A precise supporting line",
        emphasis: "guided",
        horizontal: "left",
        vertical: "top",
        fontFamily: "ui",
        fontSize: 48,
        fontWeight: 700,
      },
      homeSuggestions: {
        width: "wide",
        offsetY: 0,
        items: [
          { kind: "understand", description: "Understand the evidence" },
          { kind: "shape", description: "Shape the solution" },
          { kind: "refine", description: "Refine the result" },
          { kind: "unblock", description: "Remove the blocker" },
        ],
        card: {
          minHeight: 132,
          borderRadius: 18,
        },
      },
    },
  }),
}));

vi.mock("@/components/OpenmaHomeMark", () => ({
  OpenmaHomeMark: () => <span data-testid="home-mark" />,
}));

import {
  EmptyStateIntro,
  HOME_SUGGESTIONS,
  HomeSuggestionSelect,
} from "./HomeSuggestions";

describe("EmptyStateIntro", () => {
  it("renders the theme presentation and all default collaboration entries", () => {
    const html = renderToStaticMarkup(
      <EmptyStateIntro
        hasAgent={true}
        selectedSuggestionKind={null}
        onSelectSuggestion={() => undefined}
        onSuggestion={() => undefined}
      />,
    );

    expect(html).toContain("Theme-guided collaboration");
    expect(html).toContain("A precise supporting line");
    expect(html).toContain('<span class="home-slogan-emphasis">guided</span>');
    expect(html).toContain('data-home-hero-width="bleed"');
    expect(html).toContain("--home-hero-height:384px");
    expect(html).toContain("--home-slogan-font-size:48px");
    expect(html).toContain("--home-slogan-font-weight:700");
    expect(html).toContain("--home-suggestion-offset-y:0px");
    expect(html).toContain('data-slogan-horizontal="left"');
    expect(html).toContain('data-slogan-vertical="top"');
    expect(html).toContain('data-suggestion-width="wide"');
    expect(html).toContain("--home-suggestion-card-height:132px");
    expect(html).toContain("Understand the evidence");
    expect(html).toContain("Shape the solution");
    expect(html).toContain('data-slot="home-suggestions"');
    for (const kind of ["understand", "shape", "refine", "unblock"]) {
      expect(html).toContain(`data-suggestion-kind="${kind}"`);
    }
    expect(html).not.toContain('role="listbox"');
  });

  it("keeps the suggestion stage mounted while a category is selected", () => {
    const html = renderToStaticMarkup(
      <EmptyStateIntro
        hasAgent={true}
        selectedSuggestionKind="shape"
        onSelectSuggestion={() => undefined}
        onSuggestion={() => undefined}
      />,
    );

    expect(html).toContain('data-slot="home-suggestions"');
    expect(html).not.toContain('data-suggestion-kind="shape"');
  });
});

describe("HomeSuggestionSelect", () => {
  it("renders the localized template options with the selected slot marked", () => {
    const html = renderToStaticMarkup(
      <HomeSuggestionSelect
        selection={{ kind: "shape", label: "Shape" }}
        selectedPrompt="idea"
        onBack={() => undefined}
        onSuggestion={() => undefined}
      />,
    );

    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Shape"');
    expect(html).toContain("Help me shape");
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/role="option"/g)).toHaveLength(4);
  });
});

describe("HOME_SUGGESTIONS", () => {
  it("keeps the four general collaboration entry points in product order", () => {
    expect(HOME_SUGGESTIONS.map((suggestion) => suggestion.kind)).toEqual([
      "understand",
      "shape",
      "refine",
      "unblock",
    ]);
  });
});
