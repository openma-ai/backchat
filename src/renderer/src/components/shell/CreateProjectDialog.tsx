import { useEffect, useState } from "react";
import {
  FolderIcon,
  FolderPlusIcon,
  StarIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { folderName } from "@/lib/project-path";
import { useI18n } from "@/lib/i18n";
import type { ProjectInfo } from "@shared/projects.js";

export function ProjectFolderList({
  folders,
  onAdd,
  onMakePrimary,
  onRemove,
}: {
  folders: string[];
  onAdd: () => void;
  onMakePrimary: (folder: string) => void;
  onRemove: (folder: string) => void;
}) {
  const { t } = useI18n();
  if (folders.length === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl bg-bg-surface/55 px-6 text-center text-sm text-fg-muted transition-colors hover:bg-bg-surface/75 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <FolderPlusIcon className="size-7 text-fg-subtle" strokeWidth={1.6} />
        <span>{t("project.addFolders")}</span>
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-bg-surface/45">
      <ul className="m-0 list-none divide-y divide-border/55 p-0">
        {folders.map((folder, index) => (
          <li
            key={folder}
            className="group flex min-h-14 items-center gap-3 px-3 py-2"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg/70 text-fg-muted">
              <FolderIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">
                {folderName(folder)}
              </span>
              <span className="block truncate text-xs text-fg-subtle" title={folder}>
                {folder}
              </span>
            </span>
            {index === 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg/75 px-2 py-1 text-[11px] font-medium text-fg-muted">
                <StarIcon className="size-3" />
                {t("project.primary")}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onMakePrimary(folder)}
                className="shrink-0 rounded-md px-2 py-1 text-[11px] text-fg-subtle opacity-0 transition-opacity hover:bg-bg/70 hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100"
              >
                {t("project.makePrimary")}
              </button>
            )}
            <button
              type="button"
              onClick={() => onRemove(folder)}
              aria-label={`${t("project.removeFolder")}: ${folderName(folder)}`}
              title={t("project.removeFolder")}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-bg/70 hover:text-fg"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-10 w-full items-center justify-center gap-2 border-t border-border/55 px-3 text-xs text-fg-muted hover:bg-bg-surface/65 hover:text-fg"
      >
        <FolderPlusIcon className="size-3.5" />
        {t("project.addMoreFolders")}
      </button>
    </div>
  );
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: ProjectInfo) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setFolders([]);
      setSaving(false);
    }
  }, [open]);

  const addFolders = async () => {
    const picked = await window.backchat.uiFsPickDirs({
      defaultPath: folders[0],
    });
    if (picked.length === 0) return;
    setFolders((current) => [...new Set([...current, ...picked])]);
  };

  const create = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    setSaving(true);
    try {
      const project = await window.backchat.projectSave({
        project_id: `proj-${crypto.randomUUID()}`,
        name: trimmedName,
        source_folders: folders,
        primary_folder: folders[0],
      });
      onCreated(project);
      onOpenChange(false);
    } catch (error) {
      toast.error(t("project.createFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(680px,calc(100vw-32px))] max-w-none gap-0 rounded-2xl bg-popover p-0 sm:max-w-[680px]"
        showCloseButton
      >
        <DialogHeader className="gap-2 px-7 pb-5 pt-7">
          <DialogTitle className="text-2xl font-semibold tracking-[-0.02em]">
            {t("project.create")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("project.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-7">
          <label className="flex h-12 items-center overflow-hidden rounded-xl bg-bg-surface/55 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <span className="flex h-full w-12 shrink-0 items-center justify-center border-r border-border/60 text-fg-muted">
              <FolderIcon className="size-4.5" />
            </span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("project.name")}
              aria-label={t("project.name")}
              className="h-full min-w-0 flex-1 bg-transparent px-4 text-sm text-fg outline-none placeholder:text-fg-subtle"
            />
          </label>

          <div className="mb-3 mt-6 text-sm font-medium text-fg">
            {t("project.sourceFolders")}
          </div>
          <ProjectFolderList
            folders={folders}
            onAdd={() => void addFolders()}
            onMakePrimary={(folder) =>
              setFolders((current) => [
                folder,
                ...current.filter((candidate) => candidate !== folder),
              ])
            }
            onRemove={(folder) =>
              setFolders((current) =>
                current.filter((candidate) => candidate !== folder)
              )
            }
          />
        </div>

        <div className="mt-7 flex items-center justify-end gap-2 px-7 pb-7">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || saving}
            onClick={() => void create()}
            className="min-w-32"
          >
            {saving ? t("project.creating") : t("project.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
