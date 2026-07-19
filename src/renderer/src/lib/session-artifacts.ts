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
/** Pull file paths from a tool_call's rawInput. Walks common field
 *  names different agents use (Claude: `file_path` / `path`, Codex:
 *  `path` / `target_file`, Aider: `filename`). Best-effort — agents
 *  with custom shapes won't surface here, that's fine. */
export function extractFilePaths(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object") return [];
  const obj = rawInput as Record<string, unknown>;
  const out: string[] = [];
  const KEYS = ["path", "file_path", "filepath", "file", "target_file", "filename"];
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
