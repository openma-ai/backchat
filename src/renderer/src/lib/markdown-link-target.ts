export type MarkdownLinkTarget =
  | { kind: "http"; url: string }
  | { kind: "file"; path: string }
  | { kind: "inert" };

function decodeBrowserFilePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveMarkdownLinkTarget(
  url: string,
  cwd: string | null,
): MarkdownLinkTarget {
  const value = url.trim();
  if (!value) return { kind: "inert" };
  if (/^https?:\/\//i.test(value)) return { kind: "http", url: value };
  if (/^file:\/\//i.test(value)) {
    return { kind: "file", path: decodeBrowserFilePath(value.slice(7)) };
  }
  if (
    value.startsWith("/")
    || /^[a-z]:[\\/]/i.test(value)
    || value.startsWith("\\\\")
  ) {
    return { kind: "file", path: decodeBrowserFilePath(value) };
  }
  if (
    value.startsWith("#")
    || value.startsWith("?")
    || value.toLowerCase().startsWith("mailto:")
  ) {
    return { kind: "inert" };
  }
  if (!cwd) return { kind: "inert" };

  const windowsPath =
    /^[a-z]:[\\/]/i.test(cwd)
    || cwd.startsWith("\\\\")
    || (cwd.includes("\\") && !cwd.includes("/"));
  const separator = windowsPath ? "\\" : "/";
  const base = cwd.replace(/[\\/]+$/, "");
  let relative = decodeBrowserFilePath(value).replace(/^\.[\\/]/, "");
  if (windowsPath) relative = relative.replaceAll("/", "\\");
  return {
    kind: "file",
    path: `${base}${separator}${relative}`,
  };
}

export function markdownFileUrl(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("//")) {
    return `file://${normalized.slice(2)}`;
  }
  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

export function markdownFileLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}
