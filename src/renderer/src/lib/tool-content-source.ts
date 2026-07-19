import { localFileProtocolUrl } from "@shared/local-file-url.js";

export function resolveToolImageSource(content: {
  uri?: string;
  data?: string;
  mimeType?: string;
}): string | null {
  if (content.uri) return localFileProtocolUrl(content.uri);
  if (content.data && content.mimeType) {
    return `data:${content.mimeType};base64,${content.data}`;
  }
  return null;
}
