import path from "node:path";

const UNSUPPORTED_ADDITIONAL_DIRECTORIES =
  /does not support additional workspace directories/i;

/** Shared parent of every path, or null when the paths do not nest together. */
export function commonParentDirectory(paths: readonly string[]): string | null {
  const resolved = paths.map((value) => path.resolve(value));
  if (resolved.length < 2) return null;
  const pieces = resolved.map((value) => value.split(path.sep));
  const limit = Math.min(...pieces.map((parts) => parts.length));
  let shared = 0;
  while (
    shared < limit
    && pieces.every((parts) => parts[shared] === pieces[0]?.[shared])
  ) {
    shared += 1;
  }
  if (shared === 0) return null;
  const parent = pieces[0]!.slice(0, shared).join(path.sep) || path.sep;
  const prefix = parent === path.sep ? path.sep : `${parent}${path.sep}`;
  if (!resolved.every((value) => value === parent || value.startsWith(prefix))) return null;
  if (resolved.every((value) => value === parent)) return null;
  return parent;
}

/** When an agent rejects extra roots, run in the directory that contains them
 *  and describe each checkout in the first prompt. Returns null for any other
 *  failure so the original error still surfaces. */
export function collapseUnsupportedWorkspaceRoots(
  error: unknown,
  cwd: string,
  additionalDirectories: readonly string[],
): { cwd: string; note: string } | null {
  if (additionalDirectories.length === 0) return null;
  const message = error instanceof Error ? error.message : String(error);
  if (!UNSUPPORTED_ADDITIONAL_DIRECTORIES.test(message)) return null;
  const parent = commonParentDirectory([cwd, ...additionalDirectories]);
  if (!parent) return null;
  const lines = [cwd, ...additionalDirectories].map((dir) => `- ${dir}`);
  return {
    cwd: parent,
    note: [
      "This agent does not accept additional workspace directories.",
      `The session is running in ${parent}.`,
      "Repository checkouts:",
      ...lines,
    ].join("\n"),
  };
}
