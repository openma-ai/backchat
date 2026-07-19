/** Preserve supported URLs, promote path/host-like input to URLs, and send
 * free-form text to search. */
export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "about:blank";
  if (/^(https?|file|about):/i.test(trimmed)) return trimmed;
  if (/^\//.test(trimmed)) return `file://${trimmed}`;
  if (/^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function browserAddressLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname);
    }
  } catch {
    // Keep the raw value while a user is entering an incomplete address.
  }
  return url;
}
