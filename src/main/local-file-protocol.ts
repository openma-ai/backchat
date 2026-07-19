import { posix, win32, type PlatformPath } from "node:path";
import { localFilePathFromProtocolUrl } from "../shared/local-file-url.js";

function pathSemantics(path: string): PlatformPath {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) ? win32 : posix;
}

function isWithinRoot(path: string, root: string, pathApi: PlatformPath): boolean {
  if (!pathApi.isAbsolute(root)) return false;
  const relative = pathApi.relative(pathApi.resolve(root), path);
  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative)
    )
  );
}

export function resolveAllowedLocalFilePath(
  rawUrl: string,
  allowRoots: readonly string[],
): string | null {
  const candidate = localFilePathFromProtocolUrl(rawUrl);
  if (!candidate) return null;

  const pathApi = pathSemantics(candidate);
  if (!pathApi.isAbsolute(candidate)) return null;
  const normalized = pathApi.resolve(candidate);

  return allowRoots.some((root) => pathSemantics(root) === pathApi &&
    isWithinRoot(normalized, root, pathApi))
    ? normalized
    : null;
}
