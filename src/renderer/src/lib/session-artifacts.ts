import type { WorkspaceSourceRef } from "./session-types";
import type { OpenMAEvent } from "@openma/common/session-events/openma";

function workspaceSourceForUri(
  uri: string,
  label?: string,
): WorkspaceSourceRef | undefined {
  if (/^https?:\/\//i.test(uri)) {
    return { kind: "web", uri, ...(label ? { label } : {}) };
  }
  if (uri.startsWith("file://")) {
    try {
      return {
        kind: "file",
        uri: decodeURIComponent(new URL(uri).pathname),
        ...(label ? { label } : {}),
      };
    } catch {
      return undefined;
    }
  }
  return uri.startsWith("/")
    ? { kind: "file", uri, ...(label ? { label } : {}) }
    : undefined;
}

/** Project explicit URI-bearing canonical message content into the existing
 * Sources slot. This consumes OpenMA events only: ACP ContentBlock parsing
 * stays in the ACP bridge, and provider `_meta` never reaches GUI logic. */
export function extractCanonicalContentSources(
  event: OpenMAEvent,
): WorkspaceSourceRef[] {
  if (
    event.type !== "user.message"
    && event.type !== "agent.message"
    && event.type !== "agent.message_chunk"
    && event.type !== "agent.thinking"
  ) {
    return [];
  }
  if (!event.data || typeof event.data !== "object") return [];
  const content = (event.data as Record<string, unknown>).content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return [];
  }
  const block = content as Record<string, unknown>;
  const resource =
    block.resource && typeof block.resource === "object" && !Array.isArray(block.resource)
      ? block.resource as Record<string, unknown>
      : undefined;
  const uri =
    typeof block.uri === "string"
      ? block.uri
      : typeof resource?.uri === "string"
        ? resource.uri
        : undefined;
  if (!uri) return [];
  const label =
    typeof block.title === "string" && block.title.length > 0
      ? block.title
      : typeof block.name === "string" && block.name.length > 0
        ? block.name
        : undefined;
  const source = workspaceSourceForUri(uri, label);
  return source ? [source] : [];
}

/** Extract explicit resource citations from standard ACP Tool content. Tool
 * locations and diffs intentionally stay out: they do not prove source or
 * output provenance. */
export function extractToolContentSources(tool: {
  content?: Array<{
    type?: string;
    content?: {
      type?: string;
      uri?: string;
      title?: string;
      name?: string;
      resource?: { uri?: string };
    };
  }>;
}): WorkspaceSourceRef[] {
  const sources: WorkspaceSourceRef[] = [];
  const seen = new Set<string>();
  for (const wrapper of tool.content ?? []) {
    if (wrapper.type !== "content" || !wrapper.content) continue;
    const content = wrapper.content;
    const uri = content.uri ?? content.resource?.uri;
    if (!uri) continue;
    const source = workspaceSourceForUri(
      uri,
      content.title ?? content.name,
    );
    if (!source) continue;
    const key = `${source.kind}:${source.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

/** Merge `incoming` into `existing` newest-first, dropping duplicates
 *  and capping at `max`. Same-value re-observations bubble to index 0
 *  (most-recent-touched wins) rather than create a duplicate entry. */
export function dedupeBubble(existing: string[], incoming: string[], max: number): string[] {
  if (incoming.length === 0) return existing;
  const out = [...incoming];
  const seen = new Set(out);
  for (const v of existing) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  // Identity stability: if no actual change, return the original
  // array reference so React shallow-equals selectors short-circuit.
  if (out.length === existing.length && out.every((v, i) => v === existing[i])) {
    return existing;
  }
  return out;
}

/** Source equivalent of dedupeBubble, keyed by provenance kind + URI. */
export function dedupeSourceRefs(
  existing: WorkspaceSourceRef[],
  incoming: WorkspaceSourceRef[],
  max: number,
): WorkspaceSourceRef[] {
  if (incoming.length === 0) return existing;
  const out = [...incoming];
  const seen = new Set(out.map((source) => `${source.kind}:${source.uri}`));
  for (const source of existing) {
    const key = `${source.kind}:${source.uri}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
    if (out.length >= max) break;
  }
  if (
    out.length === existing.length
    && out.every((source, index) =>
      source.kind === existing[index]?.kind
      && source.uri === existing[index]?.uri
      && source.label === existing[index]?.label)
  ) {
    return existing;
  }
  return out;
}
/** Pull file paths from a tool_call's rawInput. Walks common field
 *  names different agents use (Claude: `file_path` / `path`, Codex:
 *  `path` / `target_file`, Aider: `filename`). Best-effort — agents
 *  with custom shapes won't surface here, that's fine. */
export function extractFilePaths(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object") return [];
  const obj = rawInput as Record<string, unknown>;
  const out: string[] = [];
  const KEYS = [
    "path",
    "filePath",
    "file_path",
    "filepath",
    "file",
    "target_file",
    "filename",
  ];
  for (const k of KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) out.push(v);
  }
  // Some tools take an array of paths (e.g. MultiEdit). Recurse one
  // level if `files` / `edits` looks like an array of objects with
  // path-ish fields.
  for (const k of ["files", "edits", "paths"]) {
    const v = obj[k];
    if (Array.isArray(v)) {
      for (const item of v) {
        out.push(...extractFilePaths(item));
      }
    }
  }
  return out;
}

/** Collect file-shaped locations/resources from ACP tool-call fields.
 * ACP defines `locations` as places a tool accessed or modified, not as
 * user-facing outputs. Callers must apply provider-specific provenance
 * before presenting any of these paths as an Output. */
export function extractToolOutputFiles(tool: {
  locations?: Array<{ path?: string }>;
  content?: Array<{
    type?: string;
    path?: string;
    newText?: string;
    content?: { type?: string; uri?: string };
  }>;
}): string[] {
  const files: string[] = [];
  for (const location of tool.locations ?? []) {
    if (location.path) files.push(location.path);
  }
  for (const block of tool.content ?? []) {
    const uri = block.type === "content" ? block.content?.uri : undefined;
    if (!uri?.startsWith("file://")) continue;
    try {
      files.push(decodeURIComponent(new URL(uri).pathname));
    } catch {
      // Ignore malformed resource URIs from custom harnesses.
    }
  }
  return [...new Set(files)];
}

const DELIVERABLE_EXTENSIONS = new Set([
  // Documents, presentations, and tabular data.
  "csv", "doc", "docx", "htm", "html", "odp", "ods", "odt", "pdf",
  "ppt", "pptx", "rtf", "tsv", "xls", "xlsx",
  // Images.
  "avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg",
  "tif", "tiff", "webp",
  // Audio and video.
  "aac", "avi", "flac", "m4a", "m4v", "mkv", "mov", "mp3", "mp4",
  "ogg", "opus", "wav", "webm",
]);

/** Files useful as direct New-tab deliverables. Source code, configs, logs,
 *  patches, and intermediate build files deliberately stay out. */
export function isDeliverableOutputPath(path: string): boolean {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? path;
  const extension = cleanPath.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
  return extension ? DELIVERABLE_EXTENSIONS.has(extension) : false;
}

/**
 * Parse Codex's explicit artifact directive from assistant text.
 *
 * The Codex desktop client treats an omitted `purpose` as an output and
 * accepts `purpose="source"` for a referenced input. Keep that provider
 * convention here, outside the provider-neutral session store.
 */
export function extractCodexFileCitations(text: string): {
  outputs: string[];
  sources: string[];
} {
  const outputs: string[] = [];
  const sources: string[] = [];
  const directive = /:{1,3}codex-file-citation\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = directive.exec(text)) !== null) {
    const attributes = parseDirectiveAttributes(match[1] ?? "");
    const path = attributes.path?.trim();
    const purpose = attributes.purpose?.trim();
    if (!path || (purpose && purpose !== "output" && purpose !== "source")) {
      continue;
    }
    if (purpose === "source") {
      sources.push(path);
    } else if (isDeliverableOutputPath(path)) {
      outputs.push(path);
    }
  }
  return {
    outputs: [...new Set(outputs)],
    sources: [...new Set(sources)],
  };
}

function parseDirectiveAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attribute = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(input)) !== null) {
    attributes[match[1]!] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

const LOCALHOST_URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s)"'`<]*)?/g;

/** POSIX basename. Substring after the final `/`; if there's no `/`,
 *  returns the input verbatim. Used for the side-tab label so the chip
 *  shows `index.html` instead of the full /Users/.../sess-…/index.html
 *  path. */
export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/** Pull absolute *.html paths out of an execute tool's rawInput so we
 *  can open them in the side BrowserTab. Two shapes:
 *
 *    - codex execute: `command: ["/bin/zsh","-lc","open /abs/x.html"]`
 *      → look in `command` array for any token matching `*.html` (or
 *      `*.htm`) after stripping argv flags. We also accept the verb
 *      being the whole command string (i.e. command is a single
 *      shell-wrapped string).
 *    - generic file_write / edit of an html file: caller passes
 *      `path` / `file_path` directly. Those go through extractFilePaths
 *      already; we filter to .html here.
 *
 *  Returns absolute paths only — relative paths would have ambiguous
 *  cwd at render-time. Empty when nothing matched. */
export function extractHtmlPathsFromExecute(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object") return [];
  const obj = rawInput as Record<string, unknown>;
  const out: string[] = [];
  const cmd = obj.command;
  let texts: string[] = [];
  if (typeof cmd === "string") texts = [cmd];
  else if (Array.isArray(cmd))
    texts = cmd.filter((x): x is string => typeof x === "string");
  for (const t of texts) {
    // /(^|\s)(\/[^\s'"]+\.html?)(\s|$)/g — absolute path ending in
    // .html or .htm, surrounded by whitespace or string edge.
    const re = /(^|\s)(\/[^\s'"]+\.html?)(?=\s|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      out.push(m[2]!);
    }
  }
  return out;
}

/** Extract localhost / dev-server URLs from any string-ish piece of
 *  a tool_call payload. Looks at the most likely fields first
 *  (rawOutput, output, stdout) and falls back to JSON-stringifying
 *  the whole object so we don't miss agents that nest output deeper. */
export function extractServiceUrls(rawOutput: unknown): string[] {
  if (rawOutput == null) return [];
  let text: string;
  if (typeof rawOutput === "string") {
    text = rawOutput;
  } else if (typeof rawOutput === "object") {
    const obj = rawOutput as Record<string, unknown>;
    const direct = obj.output ?? obj.stdout ?? obj.content;
    if (typeof direct === "string") text = direct;
    else {
      try {
        text = JSON.stringify(rawOutput);
      } catch {
        return [];
      }
    }
  } else {
    return [];
  }
  const matches = text.match(LOCALHOST_URL_RE);
  if (!matches) return [];
  // Strip trailing punctuation that often hugs a URL in shell output
  // ("at http://localhost:3000.", "(http://localhost:5173)").
  return matches.map((u) => u.replace(/[.,)\];]+$/, ""));
}
