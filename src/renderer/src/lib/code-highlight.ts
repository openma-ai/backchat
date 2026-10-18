import type { HighlighterCore } from "shiki/core";

/** Plain text: no grammar to load, rendered with line numbers only. */
export const PLAIN_LANGUAGE = "text";

/** Above these the viewer skips highlighting: tokenizing is main-thread work
 *  and a multi-megabyte log is read, not admired. */
export const HIGHLIGHT_MAX_CHARS = 400_000;
export const HIGHLIGHT_MAX_LINES = 12_000;

const FILENAME_LANGUAGES = new Map<string, string>([
  ["dockerfile", "docker"],
  ["containerfile", "docker"],
  ["makefile", "make"],
  ["gnumakefile", "make"],
  ["cmakelists.txt", "cmake"],
  ["gemfile", "ruby"],
  ["rakefile", "ruby"],
  ["podfile", "ruby"],
  ["brewfile", "ruby"],
  ["justfile", "just"],
  ["procfile", "shellscript"],
  [".bashrc", "shellscript"],
  [".zshrc", "shellscript"],
  [".profile", "shellscript"],
  [".gitignore", "shellscript"],
  [".dockerignore", "shellscript"],
  [".npmrc", "ini"],
  [".editorconfig", "ini"],
  [".gitconfig", "ini"],
  [".gitattributes", "shellscript"],
]);

const EXTENSION_LANGUAGES = new Map<string, string>([
  ["h", "c"],
  ["hpp", "cpp"],
  ["hh", "cpp"],
  ["cc", "cpp"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["env", "dotenv"],
  ["lock", "json"],
  ["conf", "ini"],
  ["cfg", "ini"],
  ["plist", "xml"],
  ["svg", "xml"],
  ["txt", PLAIN_LANGUAGE],
  ["log", "log"],
]);

let languageIndex: Promise<Map<string, string>> | null = null;

/** id + every alias → canonical shiki language id. Loaded once, lazily. */
function bundledLanguageIndex(): Promise<Map<string, string>> {
  languageIndex ??= import("shiki/langs").then(({ bundledLanguagesInfo }) => {
    const index = new Map<string, string>();
    for (const info of bundledLanguagesInfo) {
      index.set(info.id, info.id);
      for (const alias of info.aliases ?? []) index.set(alias, info.id);
    }
    return index;
  });
  return languageIndex;
}

/** Pick a grammar from the file name: exact names first, then extension,
 *  then shiki's own id/alias table. Unknown files render as plain text. */
export async function languageForPath(path: string): Promise<string> {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const byName = FILENAME_LANGUAGES.get(name);
  if (byName) return byName;
  if (name.startsWith(".env")) return "dotenv";
  if (name.startsWith("dockerfile.")) return "docker";
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  if (!extension) return PLAIN_LANGUAGE;
  const mapped = EXTENSION_LANGUAGES.get(extension);
  if (mapped) return mapped;
  return (await bundledLanguageIndex()).get(extension) ?? PLAIN_LANGUAGE;
}

let highlighter: Promise<HighlighterCore> | null = null;

function sharedHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      langs: [],
      // The JS engine avoids shipping and instantiating the Oniguruma wasm.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return highlighter;
}

/** Highlight `code` as `language` into shiki HTML carrying both themes as
 *  CSS variables (`--shiki-light` / `--shiki-dark`); styles pick by mode.
 *  Returns null for plain text or when the grammar cannot be loaded. */
export async function highlightCode(code: string, language: string): Promise<string | null> {
  if (language === PLAIN_LANGUAGE) return null;
  const core = await sharedHighlighter();
  if (!core.getLoadedLanguages().includes(language)) {
    const { bundledLanguages } = await import("shiki/langs");
    const load = bundledLanguages[language as keyof typeof bundledLanguages];
    if (!load) return null;
    try {
      await core.loadLanguage(load);
    } catch {
      return null;
    }
  }
  return core.codeToHtml(code, {
    lang: language,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}
