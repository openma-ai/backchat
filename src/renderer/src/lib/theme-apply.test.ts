import { describe, expect, it } from "vitest";

import { contrastRatio, disabledForeground, TEXT_CONTRAST_SURFACES } from "./text-roles";
import { backchatDarkTheme, backchatLightTheme } from "./theme-plugin";
import { applyThemeToRoot, type ThemeRoot } from "./theme";

function root(): ThemeRoot & { vars: Map<string, string> } {
  const vars = new Map<string, string>();
  return {
    vars,
    style: {
      setProperty(name: string, value: string) {
        vars.set(name, value);
      },
      colorScheme: "",
    },
    classList: { toggle() {} },
    dataset: {},
  };
}

describe("applyThemeToRoot", () => {
  it("writes --fg-disabled for light and dark", () => {
    for (const [light, dark, preference, systemDark] of [
      ["backchat-light", "backchat-dark", "light", false],
      ["backchat-light", "backchat-dark", "dark", true],
      ["workbench-light", "workbench-dark", "light", false],
    ] as const) {
      const target = root();
      applyThemeToRoot(light, dark, preference, systemDark, target);
      const disabled = target.vars.get("--fg-disabled");
      expect(disabled, preference).toMatch(/^#[0-9a-f]{6}$/);
      expect(target.dataset.themeMode).toBe(preference);
    }
  });

  it("keeps the dark foreground ladder where it already cleared AA", () => {
    const theme = backchatDarkTheme;
    const surfaces = TEXT_CONTRAST_SURFACES.map((name) => theme.tokens[name]);
    const disabled = disabledForeground(theme.tokens.fg, theme.tokens.bg, surfaces);
    const on = (color: string, surface: string) => contrastRatio(color, surface);
    const canvas = theme.tokens.bg;
    const panel = theme.tokens["bg-surface"];
    const measured = {
      fg: [on(theme.tokens.fg, canvas), on(theme.tokens.fg, panel)],
      muted: [on(theme.tokens["fg-muted"], canvas), on(theme.tokens["fg-muted"], panel)],
      subtle: [on(theme.tokens["fg-subtle"], canvas), on(theme.tokens["fg-subtle"], panel)],
      disabled: [on(disabled, canvas), on(disabled, panel)],
    };
    expect(theme.tokens.fg).toBe("#ebe9e1");
    expect(theme.tokens["fg-muted"]).toBe("#adab9f");
    expect(theme.tokens["fg-subtle"]).toBe("#949288");
    expect(measured.fg[0]).toBeCloseTo(14.75, 2);
    expect(measured.fg[1]).toBeCloseTo(14.02, 2);
    expect(measured.muted[0]).toBeCloseTo(7.77, 2);
    expect(measured.muted[1]).toBeCloseTo(7.39, 2);
    expect(measured.subtle[0]).toBeCloseTo(5.74, 2);
    expect(measured.subtle[1]).toBeCloseTo(5.46, 2);
    expect(measured.disabled[0]).toBeCloseTo(4.74, 2);
    expect(measured.disabled[1]).toBeCloseTo(4.50, 2);
    expect(disabled).toBe("#85837f");
    expect(backchatLightTheme.tokens["fg-muted"]).toBe("#454545");
    expect(backchatLightTheme.tokens["fg-subtle"]).toBe("#5c5c5c");
  });
});
