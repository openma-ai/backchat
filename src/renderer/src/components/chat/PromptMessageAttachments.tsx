import { FileTextIcon } from "@/components/Icons";
import type { PromptAttachment } from "@shared/session-events";
import { AttachmentImage } from "./AttachmentImage";

/** Shared sent-message attachment surface for initial prompts and injected inputs. */
export function PromptMessageAttachments({ attachments }: { attachments: readonly PromptAttachment[] }) {
  if (!attachments.length) return null;
  return <div data-user-message-attachments className="flex max-w-full flex-wrap justify-end gap-2">
    {attachments.map(file => <AttachmentImage key={file.id} file={file} variant="message" fallback={
      <a href={file.uri} download={file.name} title={file.name}
        className="inline-flex max-w-72 items-center gap-2 overflow-hidden rounded-lg border border-border p-2 text-xs">
        <FileTextIcon className="size-4 shrink-0" /><span className="min-w-0 truncate">{file.name}</span>
      </a>
    } />)}
  </div>;
}
