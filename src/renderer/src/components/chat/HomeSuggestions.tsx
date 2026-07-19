import type { CSSProperties } from "react";
import {
  BrainIcon,
  ChevronLeftIcon,
  CornerDownLeftIcon,
  FileEditIcon,
  GitBranchIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { OpenmaHomeMark } from "@/components/OpenmaHomeMark";
import {
  getHomeSuggestionFlow,
  type HomeSuggestionKind,
  type HomeSuggestionOption,
} from "@/lib/home-suggestion-flow";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  resolveThemeText,
  type ThemeHomeSuggestionSpec,
} from "@/lib/theme-plugin";
import { cn } from "@/lib/utils";
import { getThemePlugin } from "@/themes";

export const HOME_SUGGESTIONS: ReadonlyArray<{
  kind: HomeSuggestionKind;
  labelKey: TranslationKey;
  promptKey: TranslationKey;
  icon: LucideIcon;
  toneClass: string;
}> = [
  {
    kind: "understand",
    labelKey: "chat.suggestionUnderstand",
    promptKey: "chat.suggestionUnderstandPrompt",
    icon: BrainIcon,
    toneClass: "text-info",
  },
  {
    kind: "shape",
    labelKey: "chat.suggestionShape",
    promptKey: "chat.suggestionShapePrompt",
    icon: ZapIcon,
    toneClass: "text-accent-violet",
  },
  {
    kind: "refine",
    labelKey: "chat.suggestionRefine",
    promptKey: "chat.suggestionRefinePrompt",
    icon: FileEditIcon,
    toneClass: "text-success",
  },
  {
    kind: "unblock",
    labelKey: "chat.suggestionUnblock",
    promptKey: "chat.suggestionUnblockPrompt",
    icon: GitBranchIcon,
    toneClass: "text-warning",
  },
];

export type HomeSuggestionSelection = {
  kind: HomeSuggestionKind;
  label: string;
};

function renderEmphasizedText(text: string, emphasis: string | undefined) {
  if (!emphasis) return text;
  const start = text.indexOf(emphasis);
  if (start < 0) return text;
  return (
    <>
      {text.slice(0, start)}
      <span className="home-slogan-emphasis">{emphasis}</span>
      {text.slice(start + emphasis.length)}
    </>
  );
}

export function EmptyStateIntro({
  hasAgent,
  selectedSuggestionKind,
  onSelectSuggestion,
  onSuggestion,
}: {
  hasAgent: boolean;
  selectedSuggestionKind: HomeSuggestionKind | null;
  onSelectSuggestion: (selection: HomeSuggestionSelection) => void;
  onSuggestion?: (prompt: string) => void;
}) {
  const { locale, t } = useI18n();
  const { themeId, effective } = useTheme();
  const plugin = getThemePlugin(themeId, effective);
  const masthead = plugin.presentation?.homeMasthead;
  const homeHero = plugin.presentation?.homeHero;
  const homeSlogan = plugin.presentation?.homeSlogan;
  const homeSuggestions = plugin.presentation?.homeSuggestions;
  const defaultSlogan = hasAgent
    ? t("chat.whatCanIHelp")
    : t("chat.pickDefaultAgent");
  const configuredSuggestions = (
    homeSuggestions?.items ?? HOME_SUGGESTIONS
  ).map((item) => {
    const fallback = HOME_SUGGESTIONS.find(
      (suggestion) => suggestion.kind === item.kind,
    )!;
    const custom = item as ThemeHomeSuggestionSpec;
    return {
      ...fallback,
      label: resolveThemeText(
        custom.label,
        locale,
        t(fallback.labelKey),
      ),
      description: resolveThemeText(custom.description, locale, ""),
      prompt: resolveThemeText(
        custom.prompt,
        locale,
        t(fallback.promptKey),
      ),
    };
  });
  const card = homeSuggestions?.card;
  const sloganText = hasAgent
    ? resolveThemeText(homeSlogan?.text, locale, defaultSlogan)
    : defaultSlogan;
  const sloganSubtitle = hasAgent
    ? resolveThemeText(homeSlogan?.subtitle, locale, "")
    : "";
  const sloganEmphasis = hasAgent
    ? resolveThemeText(homeSlogan?.emphasis, locale, "")
    : "";
  const heroStyle = {
    ...(homeHero?.height !== undefined && {
      "--home-hero-height": `${homeHero.height}px`,
    }),
    ...(homeSlogan?.fontFamily !== undefined && {
      "--home-slogan-font-family":
        homeSlogan.fontFamily === "ui" ? "var(--font-sans)" : "var(--font-display)",
    }),
    ...(homeSlogan?.fontSize !== undefined && {
      "--home-slogan-font-size": `${homeSlogan.fontSize}px`,
    }),
    ...(homeSlogan?.fontWeight !== undefined && {
      "--home-slogan-font-weight": homeSlogan.fontWeight,
    }),
  } as CSSProperties;
  const selectSuggestionKind = (kind: HomeSuggestionKind) => {
    const flow = getHomeSuggestionFlow(kind, locale);
    const suggestion = configuredSuggestions.find(
      (item) => item.kind === kind,
    );
    if (!suggestion) return;
    onSelectSuggestion({ kind, label: suggestion.label });
    onSuggestion?.(flow.prefix);
  };
  const suggestionStyle = {
    "--home-suggestion-count": configuredSuggestions.length,
    ...(homeSuggestions?.offsetY !== undefined && {
      "--home-suggestion-offset-y": `${homeSuggestions.offsetY}px`,
    }),
    ...(card?.minHeight !== undefined && {
      "--home-suggestion-card-height": `${card.minHeight}px`,
    }),
    ...(card?.borderRadius !== undefined && {
      "--home-suggestion-card-radius": `${card.borderRadius}px`,
    }),
    ...(card?.padding !== undefined && {
      "--home-suggestion-card-padding": `${card.padding}px`,
    }),
    ...(card?.iconSize !== undefined && {
      "--home-suggestion-icon-size": `${card.iconSize}px`,
    }),
    ...(card?.gap !== undefined && {
      "--home-suggestion-gap": `${card.gap}px`,
    }),
    ...(card?.align !== undefined && {
      "--home-suggestion-align":
        card.align === "center" ? "center" : "flex-start",
      "--home-suggestion-text-align":
        card.align === "center" ? "center" : "left",
    }),
  } as CSSProperties;

  return (
    <div
      className="home-empty-intro reveal-in flex w-full flex-col items-center text-center"
      data-home-hero-width={homeHero?.width ?? "content"}
    >
      <div
        className="home-hero-panel"
        data-home-hero-surface={homeHero?.surface ?? "framed"}
        data-home-hero-width={homeHero?.width ?? "content"}
        style={heroStyle}
      >
        {masthead && (
          <div className="home-theme-masthead">
            {masthead.icon && (
              <span className="home-theme-masthead-icon" aria-hidden="true">
                {masthead.icon}
              </span>
            )}
            <span>
              <strong>{masthead.title}</strong>
              {masthead.subtitle && <small>{masthead.subtitle}</small>}
            </span>
          </div>
        )}
        <div className="theme-empty-state-art" aria-hidden="true">
          <OpenmaHomeMark />
        </div>
        <div
          className="home-hero-copy"
          data-slogan-horizontal={homeSlogan?.horizontal ?? "center"}
          data-slogan-vertical={homeSlogan?.vertical ?? "center"}
        >
          <h2
            className="home-hero-title text-2xl leading-tight text-fg"
            aria-label={sloganText}
          >
            {renderEmphasizedText(sloganText, sloganEmphasis)}
          </h2>
          {sloganSubtitle && (
            <p className="home-hero-subtitle">{sloganSubtitle}</p>
          )}
          {!hasAgent && (
            <p className="home-hero-description mt-2 max-w-sm text-sm text-fg-muted">
              {t("chat.openSettingsChooseAgent")}
            </p>
          )}
        </div>
      </div>
      <div
        data-slot="home-suggestions"
        data-suggestion-width={homeSuggestions?.width ?? "inset"}
        className="home-suggestion-stage home-suggestions mt-8 grid w-full"
        style={suggestionStyle}
      >
        {onSuggestion &&
          !selectedSuggestionKind &&
          configuredSuggestions.map((suggestion) => {
            const Icon = suggestion.icon;
            return (
              <button
                key={suggestion.kind}
                type="button"
                data-suggestion-kind={suggestion.kind}
                className="home-suggestion-card group"
                onClick={() => selectSuggestionKind(suggestion.kind)}
              >
                <span className="home-suggestion-icon" aria-hidden="true" />
                <Icon
                  className={cn(
                    "home-suggestion-fallback-icon",
                    suggestion.toneClass,
                  )}
                  aria-hidden="true"
                />
                <span className="home-suggestion-copy">
                  <span className="home-suggestion-label max-w-[16ch] text-left text-sm font-medium leading-snug text-fg">
                    {suggestion.label}
                  </span>
                  {suggestion.description && (
                    <span className="home-suggestion-description">
                      {suggestion.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

export function HomeSuggestionSelect({
  selection,
  selectedPrompt,
  onBack,
  onSuggestion,
}: {
  selection: HomeSuggestionSelection;
  selectedPrompt: string | null;
  onBack: () => void;
  onSuggestion: (option: HomeSuggestionOption) => void;
}) {
  const { locale, t } = useI18n();
  const flow = getHomeSuggestionFlow(selection.kind, locale);
  const suggestion = HOME_SUGGESTIONS.find(
    (item) => item.kind === selection.kind,
  )!;
  const Icon = suggestion.icon;

  return (
    <div className="home-suggestion-composer-popover home-suggestion-select">
      <div className="home-suggestion-select-header">
        <button
          type="button"
          className="home-suggestion-select-back"
          onClick={onBack}
          aria-label={t("chat.suggestionBack")}
          title={t("chat.suggestionBack")}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </button>
        <span className="home-suggestion-select-title">
          {selection.label}
        </span>
      </div>
      <div
        className="home-suggestion-options"
        role="listbox"
        aria-label={selection.label}
      >
        {flow.options.map((option, index) => (
          <button
            key={`${option.before}:${option.slotLabel}:${option.after}`}
            type="button"
            role="option"
            aria-selected={selectedPrompt === option.slotLabel}
            className="home-suggestion-option group"
            style={{ "--suggestion-option-index": index } as CSSProperties}
            onClick={() => onSuggestion(option)}
          >
            <Icon
              className={cn(
                "home-suggestion-option-icon",
                suggestion.toneClass,
              )}
              aria-hidden="true"
            />
            <span className="home-suggestion-option-copy">
              <span className="home-suggestion-option-prefix">
                {flow.prefix}
              </span>
              {locale === "en" ? " " : ""}
              {option.before}
              <span className="home-suggestion-slot-preview">
                {option.slotLabel}
              </span>
              {option.after}
            </span>
            <CornerDownLeftIcon
              className="home-suggestion-option-enter"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
