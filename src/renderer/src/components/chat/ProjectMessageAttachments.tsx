import { FileTextIcon } from "@/components/Icons";
import { useI18n } from "@/lib/i18n";
import type { ProjectAttachment } from "@openmatter/project-host";
export function ProjectMessageAttachments({ payload }: { payload: unknown }) {
  const { t } = useI18n();
  const files =
    (payload as { attachments?: ProjectAttachment[] } | undefined)
      ?.attachments ?? [];
  if (!files.length) return null;
  return (
    <div
      className="mb-4 flex flex-wrap justify-end gap-2"
      aria-label={t("project.messageAttachments")}
    >
      {files.map((file) => (
        <a
          key={file.id}
          download={file.name}
          href={`data:${file.mimeType};base64,${file.data}`}
          className="max-w-full rounded-lg border border-border p-2 text-xs"
          title={t("project.downloadAttachment", { name: file.name })}
        >
          {file.kind === "image" ? (
            <img
              src={`data:${file.mimeType};base64,${file.data}`}
              alt={file.name}
              className="max-h-40 max-w-full rounded"
            />
          ) : (
            <span className="flex items-center gap-2">
              <FileTextIcon className="size-4" />
              {file.name}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
