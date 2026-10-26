import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PromptAttachment } from '@shared/session-events';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { attachmentImageSource } from '@/lib/attachment-image';

/** One accessible image viewer for draft and sent attachments; never navigates away. */
export function AttachmentImage({ file, variant, fallback }: {
  file: PromptAttachment;
  variant: 'composer' | 'message';
  fallback: ReactNode;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = attachmentImageSource(file);
  if (!source || failed) return <>{fallback}</>;
  return <>
    <button ref={trigger} type="button" data-attachment-image={variant} aria-label={`${t('chat.viewImage')}: ${file.name}`}
      title={file.name} onClick={() => setOpen(true)}
      className={variant === 'composer'
        ? 'flex h-24 w-32 shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-bg/50 ring-1 ring-border/50 focus-visible:outline-2 focus-visible:outline-ring'
        : 'flex h-24 w-32 max-w-full shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-bg/30 ring-1 ring-border/40 focus-visible:outline-2 focus-visible:outline-ring'}>
      <img src={source} alt={file.name} onError={() => setFailed(true)}
        className="size-full object-contain" />
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} data-attachment-image-viewer className="w-[calc(100vw-3rem)] max-w-[1100px] gap-3 p-3 sm:max-w-[1100px]" aria-describedby={undefined}>
        <DialogTitle className="truncate pr-10 text-sm font-medium">{file.name}</DialogTitle>
        <div className="oma-scrollbar max-h-[80vh] overflow-auto rounded-lg bg-bg/40">
          <img src={source} alt={file.name} className="mx-auto max-h-[76vh] max-w-full object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
