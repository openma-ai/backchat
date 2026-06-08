import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useSettings, patchSettings } from "@/lib/settings-store";
import { useTheme } from "@/lib/theme";

/**
 * Settings → Appearance. Theme / font size / density.
 *
 * Theme writes to BOTH the local theme hook (so it takes effect instantly
 * across all windows in this process via the matchMedia listener) AND the
 * settings file. The settings file is the source of truth on app restart;
 * the hook's localStorage write inside useTheme is what survives reloads of
 * the renderer in dev mode where the main process isn't restarted.
 */
export function SettingsAppearance() {
  const settings = useSettings();
  const { theme: localTheme, setTheme } = useTheme();

  // Reconcile: if settings load shows a different theme than the local hook
  // has cached, take settings as the source of truth.
  useEffect(() => {
    if (settings && settings.appearance.theme !== localTheme) {
      setTheme(settings.appearance.theme);
    }
  }, [settings?.appearance.theme]);

  if (!settings) return null;

  const setThemeBoth = async (t: "system" | "light" | "dark") => {
    setTheme(t);
    await patchSettings({
      appearance: { ...settings.appearance, theme: t },
    });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-base font-medium text-fg">Appearance</h1>
        <p className="mt-1 text-xs text-fg-muted">
          Theme, font, density. Applies immediately across all windows.
        </p>
      </header>

      <Section label="Theme">
        <RadioGroup
          value={settings.appearance.theme}
          options={[
            { value: "system", label: "Match system" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(v) => void setThemeBoth(v as "system" | "light" | "dark")}
        />
      </Section>

      <Section label="Font size">
        <RadioGroup
          value={settings.appearance.font_size}
          options={[
            { value: "sm", label: "Small" },
            { value: "md", label: "Medium" },
            { value: "lg", label: "Large" },
          ]}
          onChange={(v) =>
            void patchSettings({
              appearance: { ...settings.appearance, font_size: v as "sm" | "md" | "lg" },
            })
          }
        />
      </Section>

      <Section label="Density">
        <RadioGroup
          value={settings.appearance.density}
          options={[
            { value: "compact", label: "Compact" },
            { value: "default", label: "Default" },
            { value: "roomy", label: "Roomy" },
          ]}
          onChange={(v) =>
            void patchSettings({
              appearance: {
                ...settings.appearance,
                density: v as "compact" | "default" | "roomy",
              },
            })
          }
        />
      </Section>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
        {label}
      </h2>
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
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-bg-surface/40 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-2 py-1.5 text-xs transition-colors",
            value === o.value
              ? "bg-bg text-fg shadow-chip-press"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
