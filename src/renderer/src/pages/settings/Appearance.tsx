import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings, patchSettings } from "@/lib/settings-store";
import type { ThemeModePreference, ThemePlugin } from "@/lib/theme-plugin";
import { builtInThemes } from "@/themes";
import { useTheme } from "@/lib/theme";
import { useI18n, type LanguagePreference } from "@/lib/i18n";
import { mergeAppearanceSettings } from "./appearance-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

/** Settings → Appearance. Plugin selection stays safe and declarative while
 * the preview makes the active theme's visual consequences obvious. */
export function SettingsAppearance() {
  const settings = useSettings();
  const { effective } = useTheme();
  const { t } = useI18n();
  const lightThemes = builtInThemes.filter((theme) => theme.appearance === "light");
  const darkThemes = builtInThemes.filter((theme) => theme.appearance === "dark");

  if (!settings) return null;

  const selectedLight = lightThemes.find((theme) =>
    theme.id === settings.appearance.light_theme_id) ?? lightThemes[0]!;
  const selectedDark = darkThemes.find((theme) =>
    theme.id === settings.appearance.dark_theme_id) ?? darkThemes[0]!;
  const previewTheme = effective === "dark" ? selectedDark : selectedLight;

  return (
    <div className="mx-auto max-w-[960px] space-y-8 text-xs">
      <header>
        <h1 className="text-2xl font-medium tracking-[-0.02em] text-fg">
          {t("appearance.title")}
        </h1>
        <p className="mt-2 max-w-[68ch] text-xs leading-5 text-fg-muted">
          {t("appearance.description")}
        </p>
      </header>

      <Section label={t("appearance.theme")}>
        <div className="grid grid-cols-3 gap-3">
          <AppearanceModeCard
            mode="system"
            label={t("appearance.themeSystem")}
            selected={settings.appearance.theme === "system"}
            onSelect={updateMode(settings.appearance, "system")}
          />
          <AppearanceModeCard
            mode="light"
            label={t("appearance.themeLight")}
            selected={settings.appearance.theme === "light"}
            onSelect={updateMode(settings.appearance, "light")}
          />
          <AppearanceModeCard
            mode="dark"
            label={t("appearance.themeDark")}
            selected={settings.appearance.theme === "dark"}
            onSelect={updateMode(settings.appearance, "dark")}
          />
        </div>
      </Section>

      <Section
        label={t("appearance.colorTheme")}
        description={t("appearance.colorThemeDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ThemeSelect
            label={t("appearance.lightColorTheme")}
            themes={lightThemes}
            value={settings.appearance.light_theme_id}
            onChange={(lightThemeId) => void patchSettings({
              appearance: mergeAppearanceSettings(settings.appearance, {
                light_theme_id: lightThemeId,
              }),
            })}
          />
          <ThemeSelect
            label={t("appearance.darkColorTheme")}
            themes={darkThemes}
            value={settings.appearance.dark_theme_id}
            onChange={(darkThemeId) => void patchSettings({
              appearance: mergeAppearanceSettings(settings.appearance, {
                dark_theme_id: darkThemeId,
              }),
            })}
          />
        </div>
        <ThemeWorkbenchPreview theme={previewTheme} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section label={t("appearance.language")} compact>
          <RadioGroup
            value={settings.appearance.language}
            options={[
              { value: "system", label: t("appearance.languageSystem") },
              { value: "en", label: t("appearance.languageEnglish") },
              { value: "zh-CN", label: t("appearance.languageChinese") },
            ]}
            onChange={(language) => void patchSettings({
              appearance: mergeAppearanceSettings(settings.appearance, {
                language: language as LanguagePreference,
              }),
            })}
          />
        </Section>

        <Section label={t("appearance.fontSize")} compact>
          <RadioGroup
            value={settings.appearance.font_size}
            options={[
              { value: "sm", label: t("appearance.fontSmall") },
              { value: "md", label: t("appearance.fontMedium") },
              { value: "lg", label: t("appearance.fontLarge") },
            ]}
            onChange={(fontSize) => void patchSettings({
              appearance: mergeAppearanceSettings(settings.appearance, {
                font_size: fontSize as "sm" | "md" | "lg",
              }),
            })}
          />
        </Section>

        <Section label={t("appearance.density")} compact>
          <RadioGroup
            value={settings.appearance.density}
            options={[
              { value: "compact", label: t("appearance.densityCompact") },
              { value: "default", label: t("appearance.densityDefault") },
              { value: "roomy", label: t("appearance.densityRoomy") },
            ]}
            onChange={(density) => void patchSettings({
              appearance: mergeAppearanceSettings(settings.appearance, {
                density: density as "compact" | "default" | "roomy",
              }),
            })}
          />
        </Section>
      </div>
    </div>
  );
}

function updateMode(
  appearance: NonNullable<ReturnType<typeof useSettings>>["appearance"],
  theme: ThemeModePreference,
) {
  return () => void patchSettings({
    appearance: mergeAppearanceSettings(appearance, { theme }),
  });
}

function AppearanceModeCard({
  mode,
  label,
  selected,
  onSelect,
}: {
  mode: ThemeModePreference;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = mode === "system" ? MonitorIcon : mode === "light" ? SunIcon : MoonIcon;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2",
        "focus-visible:outline-brand",
      )}
    >
      <span
        className={cn(
          "relative flex h-28 overflow-hidden rounded-xl border transition-colors",
          selected ? "border-brand" : "border-border group-hover:border-border-strong",
        )}
        aria-hidden="true"
      >
        <ModePane dark={mode === "dark" || mode === "system"} className="flex-1" />
        {mode === "system" && <ModePane dark={false} className="flex-1" />}
        <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-bg/80 text-fg shadow-sm">
          <Icon className="size-3.5" />
        </span>
      </span>
      <span className={cn(
        "mt-2 block text-center text-xs",
        selected ? "font-medium text-fg" : "text-fg-muted",
      )}>
        {label}
      </span>
    </button>
  );
}

function ModePane({ dark, className }: { dark: boolean; className?: string }) {
  const background = dark ? "#252423" : "#f8f8f7";
  const sidebar = dark ? "#343332" : "#e8e8e6";
  const line = dark ? "#777674" : "#b5b4b0";
  return (
    <span className={cn("flex", className)} style={{ background }}>
      <span className="w-[28%]" style={{ background: sidebar }} />
      <span className="flex flex-1 flex-col justify-center gap-2 px-3">
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: line }} />
        <span className="h-1.5 w-1/2 rounded-full opacity-60" style={{ background: line }} />
        <span className="h-8 rounded-md border border-black/5 bg-white/55" />
      </span>
    </span>
  );
}

function ThemeSelect({
  label,
  themes,
  value,
  onChange,
}: {
  label: string;
  themes: readonly ThemePlugin[];
  value: string;
  onChange: (themeId: string) => void;
}) {
  const selected = themes.find((theme) => theme.id === value) ?? themes[0]!;
  return (
    <div className="rounded-xl border border-border bg-bg p-3">
      <div className="mb-2 text-[11px] font-medium text-fg-muted">{label}</div>
      <Select value={selected.id} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full bg-bg-surface text-xs">
          <span className="flex min-w-0 items-center gap-2">
            <ThemeGlyph theme={selected} />
            <span className="truncate">{selected.name}</span>
          </span>
        </SelectTrigger>
        <SelectContent align="start">
          {themes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id} className="text-xs">
              <span className="flex items-center gap-2">
                <ThemeGlyph theme={theme} />
                <span>{theme.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ThemeGlyph({ theme }: { theme: ThemePlugin }) {
  return (
    <span
      className="grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold"
      style={{ background: theme.preview.surface, color: theme.preview.accent }}
      aria-hidden="true"
    >
      Aa
    </span>
  );
}

function ThemeWorkbenchPreview({ theme }: { theme: ThemePlugin }) {
  const roles = [
    ["Accent", theme.tokens.brand],
    ["Background", theme.tokens.bg],
    ["Foreground", theme.tokens.fg],
  ] as const;
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex min-h-32" style={{ background: theme.preview.background }}>
        <div className="w-[22%] border-r border-black/5 p-3" style={{ background: theme.preview.surface }}>
          <div className="h-2 w-12 rounded-full opacity-50" style={{ background: theme.preview.foreground }} />
          <div className="mt-4 space-y-2">
            <div className="h-6 rounded-md opacity-90" style={{ background: theme.preview.background }} />
            <div className="h-2 w-2/3 rounded-full opacity-25" style={{ background: theme.preview.foreground }} />
            <div className="h-2 w-3/4 rounded-full opacity-25" style={{ background: theme.preview.foreground }} />
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-between p-4">
          <div>
            <div className="text-sm font-medium" style={{ color: theme.preview.foreground }}>{theme.name}</div>
            <div className="mt-1 max-w-[54ch] text-[10px] opacity-65" style={{ color: theme.preview.foreground }}>
              {theme.description}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="h-10 flex-1 rounded-lg border border-black/10 bg-white/45" />
            <div className="h-8 w-20 rounded-lg" style={{ background: theme.preview.accent }} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
        {roles.map(([label, color]) => (
          <div key={label} className="flex items-center gap-2 px-3 py-2">
            <span className="size-3 rounded-full border border-border" style={{ background: color }} />
            <span className="text-[10px] text-fg-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  label,
  description,
  compact,
  children,
}: {
  label: string;
  description?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={compact ? "min-w-0" : undefined}>
      <div className="mb-2">
        <h2 className="text-xs font-medium text-fg">{label}</h2>
        {description && (
          <p className="mt-1 max-w-[68ch] text-[11px] leading-4 text-fg-muted">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function RadioGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-border/60 bg-bg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-[11px] transition-colors",
            value === option.value
              ? "bg-bg-surface text-fg shadow-chip-press"
              : "text-fg-muted hover:bg-bg-surface/50 hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
