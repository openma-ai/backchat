import { watchFile, unwatchFile, type Stats } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_INLINE_VISUALIZATION_BYTES = 2 * 1024 * 1024;
const MAX_VISUALIZATION_SEARCH_DEPTH = 8;

interface InlineVisualizationFileOptions {
  visualizationRoot?: string;
  interval?: number;
}

function validateInput(input: { cwd: string; file: string }): void {
  if (!input.cwd?.trim() || !input.file?.trim()) {
    throw new Error("Visualization workspace and file are required");
  }
  if (isAbsolute(input.file)) {
    throw new Error("Visualization files must stay inside the workspace");
  }
  const extension = extname(input.file).toLowerCase();
  if (extension !== ".html" && extension !== ".htm") {
    throw new Error("Visualization files must be HTML fragments");
  }
  if (input.file.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Visualization files must stay inside the workspace");
  }
}

async function findLatestVisualization(root: string, file: string): Promise<string | undefined> {
  const normalizedSuffix = file.split("/").join(sep);
  const matches: Array<{ path: string; mtimeMs: number }> = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_VISUALIZATION_SEARCH_DEPTH) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
        return;
      }
      if (!entry.isFile()) return;
      const fromRoot = relative(root, path);
      if (fromRoot !== normalizedSuffix && !fromRoot.endsWith(`${sep}${normalizedSuffix}`)) return;
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile()) matches.push({ path, mtimeMs: info.mtimeMs });
    }));
  };
  await visit(root, 0);
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches[0]?.path;
}

export async function resolveInlineVisualizationFile(
  input: { cwd: string; file: string },
  options: InlineVisualizationFileOptions = {},
): Promise<string> {
  validateInput(input);
  const root = await realpath(input.cwd);
  const candidate = resolve(root, input.file);
  const target = await realpath(candidate).catch(() => undefined);
  if (target) {
    const fromRoot = relative(root, target);
    if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      throw new Error("Visualization files must stay inside the workspace");
    }
    return target;
  }
  const visualizationRoot = options.visualizationRoot
    ?? join(homedir(), ".codex", "visualizations");
  const external = await findLatestVisualization(visualizationRoot, input.file);
  if (external) return external;
  throw new Error(`Visualization file not found: ${input.file}`);
}

export async function readInlineVisualizationFile(input: {
  cwd: string;
  file: string;
}, options: InlineVisualizationFileOptions = {}): Promise<{ file: string; content: string }> {
  const target = await resolveInlineVisualizationFile(input, options);

  const info = await stat(target);
  if (!info.isFile()) throw new Error("Visualization path is not a file");
  if (info.size > MAX_INLINE_VISUALIZATION_BYTES) {
    throw new Error("Visualization fragments must be 2 MB or smaller");
  }
  return { file: input.file, content: await readFile(target, "utf8") };
}

export async function watchInlineVisualizationFile(
  input: { cwd: string; file: string },
  onChange: () => void,
  options: InlineVisualizationFileOptions = {},
): Promise<() => void> {
  const target = await resolveInlineVisualizationFile(input, options);
  const listener = (current: Stats, previous: Stats) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) onChange();
  };
  watchFile(target, {
    interval: Math.max(50, options.interval ?? 120),
    persistent: false,
  }, listener);
  return () => unwatchFile(target, listener);
}
