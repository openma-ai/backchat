/**
 * Text color roles for the renderer.
 *
 * Theme plugins own the first three rungs (`fg`, `fg-muted`, `fg-subtle`).
 * `fg-disabled` is derived here, not stored on the plugin. Inactive UI is
 * exempt from WCAG 1.4.3 and 1.4.11. Pushing it to 4.5:1 or 3:1 put it
 * next to `fg-subtle`, and enabled icons use that role, so a disabled
 * control looked on. The mix is the weakest ink that still holds 2:1 on
 * every surface: the glyph stays visible, and it lands well clear of
 * `fg-subtle`.
 *
 * Surfaces: body copy, secondary labels, hints, and disabled controls live
 * on `--bg`, `--bg-sidebar`, and `--bg-surface`. The user bubble is a
 * primary-text surface (`fg` only).
 */

export const TEXT_ROLE_NAMES = ["fg", "fg-muted", "fg-subtle", "fg-disabled"] as const;
export type TextRoleName = (typeof TEXT_ROLE_NAMES)[number];

/** WCAG 2.1 AA for text under 18pt / 14pt bold. */
export const WCAG_AA_NORMAL_TEXT = 4.5;

/** Inactive components are exempt from 1.4.11. 2:1 keeps the glyph visible
 *  without sitting on top of the enabled icon color. */
export const DISABLED_SURFACE_CONTRAST = 2;

/** Resting icon ink (`fg-subtle`) versus disabled ink. Below ~2:1 the two
 *  grays read as one control state. */
export const DISABLED_ENABLED_GAP = 2.5;

/** Adjacent roles must stay at least this far apart on the canvas. */
export const TEXT_ROLE_MIN_GAP = 0.8;

export const TEXT_CONTRAST_SURFACES = ["bg", "bg-surface", "bg-sidebar"] as const;

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Weakest legible disabled color for one theme. `amount` is the share of `foreground`. */
export function disabledForeground(
  foreground: string,
  background: string,
  surfaces: readonly string[],
): string {
  let low = 0;
  let high = 1;
  let chosen = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const color = mixSrgb(foreground, background, mid);
    const worst = worstContrast(color, surfaces);
    if (worst >= DISABLED_SURFACE_CONTRAST) {
      chosen = mid;
      high = mid;
    } else {
      low = mid;
    }
  }

  let amount = chosen;
  let hex = mixSrgb(foreground, background, amount);
  for (let step = 0; step < 40; step += 1) {
    if (worstContrast(hex, surfaces) >= DISABLED_SURFACE_CONTRAST) return hex;
    amount = Math.min(1, amount + 0.004);
    hex = mixSrgb(foreground, background, amount);
  }
  return hex;
}

function worstContrast(color: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(color, surface)));
}

export function mixSrgb(foreground: string, background: string, foregroundAmount: number): string {
  const fg = srgbChannels(foreground);
  const bg = srgbChannels(background);
  const amount = Math.min(1, Math.max(0, foregroundAmount));
  const mixed = fg.map((channel, index) => channel * amount + bg[index]! * (1 - amount));
  return `#${mixed
    .map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function relativeLuminance(color: string): number {
  const [r, g, b] = color.startsWith("#") ? hexToLinearRgb(color) : oklchToLinearRgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function srgbChannels(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split("").map((channel) => channel + channel).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
  }
  return oklchToLinearRgb(color).map(linearChannelToSrgb) as [number, number, number];
}

function linearChannelToSrgb(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function hexToLinearRgb(color: string): [number, number, number] {
  return srgbChannels(color).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
}

function oklchToLinearRgb(color: string): [number, number, number] {
  const match = color.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!match) throw new Error(`Unsupported color token: ${color}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
}
