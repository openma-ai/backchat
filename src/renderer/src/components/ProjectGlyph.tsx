import { BoxIcon, DiamondIcon, HexagonIcon, LayersIcon, OrbitIcon, RadarIcon, ShapesIcon, SparklesIcon, RocketIcon, GlobeIcon, MountainIcon, SunIcon, MoonIcon, StarIcon, FlameIcon, LeafIcon, HeartIcon, GemIcon, CloudIcon, ZapIcon, CoffeeIcon, MusicIcon, CameraIcon, PaletteIcon, CodeIcon, TerminalIcon, DatabaseIcon, CpuIcon, ShieldIcon, CompassIcon, FlagIcon, AnchorIcon } from "./Icons";
import * as CustomIcons from "./BackchatIcons";
import { useEffect, useState, type CSSProperties } from "react";

const legacyProjectGlyphs = [
  ["box", "方块", BoxIcon], ["diamond", "菱形", DiamondIcon], ["hexagon", "六边形", HexagonIcon], ["layers", "层叠", LayersIcon],
  ["orbit", "轨道", OrbitIcon], ["radar", "雷达", RadarIcon], ["shapes", "形状", ShapesIcon], ["sparkles", "闪光", SparklesIcon],
  ["rocket", "火箭", RocketIcon], ["globe", "地球", GlobeIcon], ["mountain", "山峰", MountainIcon], ["sun", "太阳", SunIcon],
  ["moon", "月亮", MoonIcon], ["star", "星星", StarIcon], ["flame", "火焰", FlameIcon], ["leaf", "树叶", LeafIcon],
  ["heart", "爱心", HeartIcon], ["gem", "宝石", GemIcon], ["cloud", "云", CloudIcon], ["zap", "闪电", ZapIcon],
  ["coffee", "咖啡", CoffeeIcon], ["music", "音乐", MusicIcon], ["camera", "相机", CameraIcon], ["palette", "调色板", PaletteIcon],
  ["code", "代码", CodeIcon], ["terminal", "终端", TerminalIcon], ["database", "数据库", DatabaseIcon], ["cpu", "芯片", CpuIcon],
  ["shield", "盾牌", ShieldIcon], ["compass", "指南针", CompassIcon], ["flag", "旗帜", FlagIcon], ["anchor", "船锚", AnchorIcon],
] as const;
export const projectGlyphs = [
  ["box", "方块", CustomIcons.ProjectsIcon],
  ["folder", "文件夹", CustomIcons.FolderClosedIcon],
  ["star", "星星", CustomIcons.StarIcon],
  ["cloud", "云", CustomIcons.CloudIcon],
  ["terminal", "终端", CustomIcons.TerminalIcon],
  ["database", "数据库", CustomIcons.DatabaseIcon],
  ["plugin", "插件", CustomIcons.PluginIcon],
  ["book", "书本", CustomIcons.BookIcon],
  ["camera", "相机", CustomIcons.CameraIcon],
  ["palette", "调色板", CustomIcons.PaletteIcon],
  ["branch", "分支", CustomIcons.BranchIcon],
  ["chat", "对话", CustomIcons.ChatIcon],
] as const;
const allProjectGlyphs = [...projectGlyphs, ...legacyProjectGlyphs];
export const projectColors = ["#7c3aed", "#2563eb", "#0d9488", "#e11d48", "#d97706", "#c026d3", "#ff0080", "#64748b"];
export type ProjectIconChoice = { kind: "icon"; glyph: string; color: string } | { kind: "emoji"; emoji: string };
const storageKey = (key: string) => `backchat.project-icon.v1:${key}`;
export function readProjectIcon(key: string): ProjectIconChoice | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(key)) ?? "null");
    if (value?.kind === "icon" && allProjectGlyphs.some(([name]) => name === value.glyph) && /^#[0-9a-f]{6}$/i.test(value.color)) return value;
    if (value?.kind === "emoji" && typeof value.emoji === "string" && value.emoji.length <= 16 && /\p{Extended_Pictographic}/u.test(value.emoji)) return value;
  } catch { /* A stale preference falls back to automatic. */ }
  return null;
}
export function saveProjectIcon(key: string, value: ProjectIconChoice | null) {
  if (value) localStorage.setItem(storageKey(key), JSON.stringify(value));
  else localStorage.removeItem(storageKey(key));
  window.dispatchEvent(new Event("project-icon-changed"));
}
/** Hues for the automatic letter tile. One lightness and chroma per theme
 *  (see `.project-letter` in index.css), so no tile shouts over another. */
export const PROJECT_LETTER_HUES = [30, 70, 145, 195, 250, 290, 340] as const;

function identityHash(identity: string): number {
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/** First letter or ideograph of the name, skipping punctuation such as a
 *  leading dot or bracket. */
export function projectInitial(name: string): string {
  const match = name.match(/[\p{L}\p{N}]/u);
  return (match?.[0] ?? "?").toLocaleUpperCase();
}

export function ProjectGlyph({ identity, name, choice }: {
  identity: string;
  /** Display name the automatic tile takes its letter from. */
  name?: string;
  choice?: ProjectIconChoice | null;
}) {
  if (choice?.kind === "emoji") return <span aria-hidden="true" className="text-[14px] leading-none">{choice.emoji}</span>;
  const picked = choice?.kind === "icon" ? allProjectGlyphs.find(([glyph]) => glyph === choice.glyph) : undefined;
  if (picked && choice?.kind === "icon") {
    const Glyph = picked[2];
    return <Glyph aria-hidden="true" className="size-full" style={{ color: choice.color }} data-project-glyph={choice.glyph} />;
  }
  const hue = PROJECT_LETTER_HUES[identityHash(identity) % PROJECT_LETTER_HUES.length]!;
  const label = name || identity.split("/").filter(Boolean).pop() || identity;
  const initial = projectInitial(label);
  // Latin capitals (esp. L) need an optical nudge in CSS; CJK/digits stay geometric.
  const initialKind = /^[A-Z]$/i.test(initial) ? "latin" : /^\d$/.test(initial) ? "digit" : "other";
  return (
    <span
      aria-hidden="true"
      className="project-letter"
      style={{ "--project-hue": hue } as CSSProperties}
      data-project-glyph="letter"
      data-initial-kind={initialKind}
    >
      {initial}
    </span>
  );
}

export function useProjectIcon(key: string) {
  const [choice, setChoice] = useState(() => readProjectIcon(key));
  useEffect(() => {
    const sync = () => setChoice(readProjectIcon(key));
    sync();
    window.addEventListener("project-icon-changed", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("project-icon-changed", sync); window.removeEventListener("storage", sync); };
  }, [key]);
  return choice;
}
