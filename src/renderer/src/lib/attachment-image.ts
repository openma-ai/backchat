import type { PromptAttachment } from '@shared/session-events';
import { localFileProtocolUrl } from '@shared/local-file-url';

/** Persisted/older uploads may say kind=file; raster metadata still identifies them. */
export function attachmentImageSource(file: PromptAttachment): string | undefined {
  const mime = file.mimeType?.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase();
  const rasterMime = mime && /^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(mime);
  const rasterExtension = extension && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'].includes(extension);
  const explicitSvg = file.kind === 'image' && mime === 'image/svg+xml';
  if (!rasterMime && !rasterExtension && !explicitSvg) return undefined;
  const resolvedMime = rasterMime || explicitSvg ? mime : `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  if (file.data) return `data:${resolvedMime};base64,${file.data}`;
  return file.path ? localFileProtocolUrl(file.path) : undefined;
}
