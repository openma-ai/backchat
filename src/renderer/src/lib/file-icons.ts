/**
 * File / folder icon lookup backed by VS Code's Material Icon Theme
 * (`material-icon-theme`, MIT). We only read its manifest — the same
 * file-name → extension → language → default precedence VS Code uses —
 * and reference the shipped SVGs as URLs, so each icon is a plain <img>
 * that loads on demand and never collides with another SVG's ids.
 */
import manifest from "material-icon-theme/dist/material-icons.json";

type IconMap = Record<string, string>;

interface Manifest {
  iconDefinitions: Record<string, { iconPath: string }>;
  file: string;
  folder: string;
  folderExpanded: string;
  rootFolder: string;
  rootFolderExpanded: string;
  fileNames: IconMap;
  fileExtensions: IconMap;
  folderNames: IconMap;
  folderNamesExpanded: IconMap;
  languageIds: IconMap;
  light?: {
    fileNames?: IconMap;
    fileExtensions?: IconMap;
    folderNames?: IconMap;
    folderNamesExpanded?: IconMap;
  };
}

const m = manifest as unknown as Manifest;

// Every shipped SVG as a lazily-resolved asset URL. Vite fingerprints them
// into the build; nothing is inlined into the JS bundle.
const SVG_URLS = import.meta.glob<string>(
  "../../../../node_modules/material-icon-theme/icons/*.svg",
  { query: "?url", import: "default", eager: true },
);

const URL_BY_ICON = new Map<string, string>();
for (const [path, url] of Object.entries(SVG_URLS)) {
  const name = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
  URL_BY_ICON.set(name, url);
}

// The manifest is case-sensitive; VS Code matches case-insensitively.
function lowerKeys(map: IconMap | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(map ?? {})) {
    const key = k.toLowerCase();
    if (!out.has(key)) out.set(key, v);
  }
  return out;
}

const FILE_NAMES = lowerKeys(m.fileNames);
const FILE_EXTS = lowerKeys(m.fileExtensions);
const FOLDER_NAMES = lowerKeys(m.folderNames);
const FOLDER_NAMES_OPEN = lowerKeys(m.folderNamesExpanded);
const LIGHT_FILE_NAMES = lowerKeys(m.light?.fileNames);
const LIGHT_FILE_EXTS = lowerKeys(m.light?.fileExtensions);
const LIGHT_FOLDER_NAMES = lowerKeys(m.light?.folderNames);
const LIGHT_FOLDER_NAMES_OPEN = lowerKeys(m.light?.folderNamesExpanded);

// A handful of extensions VS Code resolves via language id rather than the
// extension table (e.g. `.json` → json, `.go` → go).
const LANGUAGE_BY_EXT: Record<string, string> = {
  json: "json", go: "go", css: "css", toml: "toml", svg: "svg",
  html: "html", xml: "xml", sql: "sql", sh: "shellscript", bash: "shellscript",
  zsh: "shellscript", java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", rb: "ruby", php: "php", swift: "swift", kt: "kotlin",
  lua: "lua", r: "r", scss: "scss", less: "less", yaml: "yaml", yml: "yaml",
  vue: "vue", dart: "dart", ini: "ini", dockerfile: "dockerfile",
};

function urlFor(iconName: string | undefined): string | undefined {
  if (!iconName) return undefined;
  return URL_BY_ICON.get(iconName) ?? URL_BY_ICON.get(iconName.replace(/_light$/, ""));
}

export function fileIconName(fileName: string, light = false): string {
  const name = fileName.toLowerCase();
  const byName = (light && LIGHT_FILE_NAMES.get(name)) || FILE_NAMES.get(name);
  if (byName) return byName;
  // Longest compound extension first: `d.ts` before `ts`, `test.tsx` before `tsx`.
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    const byExt = (light && LIGHT_FILE_EXTS.get(ext)) || FILE_EXTS.get(ext);
    if (byExt) return byExt;
  }
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const lang = LANGUAGE_BY_EXT[last];
  if (lang && m.languageIds[lang]) return m.languageIds[lang];
  return m.file;
}

export function folderIconName(folderName: string, open: boolean, light = false): string {
  const name = folderName.toLowerCase();
  const table = open
    ? ((light && LIGHT_FOLDER_NAMES_OPEN.get(name)) || FOLDER_NAMES_OPEN.get(name))
    : ((light && LIGHT_FOLDER_NAMES.get(name)) || FOLDER_NAMES.get(name));
  return table ?? (open ? m.folderExpanded : m.folder);
}

export function fileIconUrl(fileName: string, light = false): string | undefined {
  return urlFor(fileIconName(fileName, light)) ?? urlFor(m.file);
}

export function folderIconUrl(folderName: string, open: boolean, light = false): string | undefined {
  return (
    urlFor(folderIconName(folderName, open, light)) ??
    urlFor(open ? m.folderExpanded : m.folder)
  );
}
