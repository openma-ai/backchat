import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { showOpenmaFile } from "@/lib/openma-file-preview";
import { sessionStore } from "@/lib/session-store";
import { useI18n } from "@/lib/i18n";

export function OpenmaTaskFiles({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const { data: files, error, isPending } = useQuery({ queryKey: ["openma-files", taskId], queryFn: () => window.backchat.openmaTaskFiles(taskId), enabled: open, staleTime: 0 });
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="app-compact-control"><FileIcon className="size-3.5" />{t("openma.files")}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {files?.map((file) => <DropdownMenuItem key={file.id} onSelect={() => showOpenmaFile(taskId, file.id)}>{file.name}</DropdownMenuItem>)}
      {!files?.length && <p className="p-2 text-xs text-fg-muted">{t(isPending ? "openma.loadingFiles" : error ? "openma.filesUnavailable" : "openma.noFiles")}</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function OpenmaFilePreviewDialog() {
  const [selected, setSelected] = useState<{ taskId: string; fileId: string }>();
  const { t } = useI18n();
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; fileId: string }>).detail;
      if (sessionStore.get(detail.taskId)?.openma) setSelected(detail);
    };
    const offAccount = window.backchat.onOpenmaAccount(() => setSelected(undefined));
    window.addEventListener("backchat:openma-file", listener);
    return () => { offAccount(); window.removeEventListener("backchat:openma-file", listener); };
  }, []);
  const { data, error, isPending } = useQuery({ queryKey: ["openma-file-preview", selected?.taskId, selected?.fileId], queryFn: () => window.backchat.openmaTaskFilePreview(selected!.taskId, selected!.fileId), enabled: !!selected, gcTime: 0, retry: false });
  return <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(undefined); }}>
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>{data?.file.name ?? t("openma.files")}</DialogTitle><DialogDescription>{t("openma.remoteFile")}</DialogDescription></DialogHeader>
      {isPending ? <p>{t("openma.loadingFiles")}</p> : error ? <p role="alert">{error.message}</p> : data?.text !== undefined ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-xs">{data.text}</pre> : data?.dataUrl ? <img className="max-h-[60vh] object-contain" src={data.dataUrl} alt={data.file.name} /> : <p>{t("openma.downloadToView")}</p>}
      <Button variant="outline" onClick={() => {
        if (selected) void window.backchat.openmaTaskFileDownload(selected.taskId, selected.fileId).catch((error) => toast.error(String(error)));
      }}>{t("openma.saveFile")}</Button>
    </DialogContent>
  </Dialog>;
}
