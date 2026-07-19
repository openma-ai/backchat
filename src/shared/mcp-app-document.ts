import type { McpAppResourceMeta } from "./mcp-app.js";

function cleanOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function origins(values: string[] | undefined): string {
  return [...new Set((values ?? []).map(cleanOrigin).filter((value): value is string => !!value))].join(" ");
}

export function buildMcpAppDocument(html: string, csp?: McpAppResourceMeta["csp"]): string {
  const connect = origins(csp?.connectDomains);
  const resources = origins(csp?.resourceDomains);
  const frames = origins(csp?.frameDomains);
  const bases = origins(csp?.baseUriDomains);
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob:" + (resources ? ` ${resources}` : ""),
    "style-src 'unsafe-inline'" + (resources ? ` ${resources}` : ""),
    "img-src data: blob:" + (resources ? ` ${resources}` : ""),
    "font-src data:" + (resources ? ` ${resources}` : ""),
    "media-src data: blob:" + (resources ? ` ${resources}` : ""),
    "connect-src" + (connect ? ` ${connect}` : " 'none'"),
    "frame-src" + (frames ? ` ${frames}` : " 'none'"),
    "base-uri" + (bases ? ` ${bases}` : " 'none'"),
    "form-action 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  return `<!doctype html><html><head>${meta}</head><body>${html}</body></html>`;
}
