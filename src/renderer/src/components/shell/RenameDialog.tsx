import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

export function RenameDialog({
  open,
  currentTitle,
  onOpenChange,
  onRename,
}: {
  open: boolean;
  currentTitle: string;
  onOpenChange: (open: boolean) => void;
  onRename: (title: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(currentTitle);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(currentTitle);
      setSaving(false);
    }
  }, [currentTitle, open]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onRename(trimmed);
      onOpenChange(false);
    } catch (error) {
      toast.error(t("sidebar.renameFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t("sidebar.rename")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("sidebar.renameDescription")}
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          aria-label={t("sidebar.rename")}
          className="h-9 w-full rounded-lg bg-bg-surface/60 px-3 text-sm text-fg outline-none ring-ring placeholder:text-fg-subtle focus-visible:ring-2"
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!title.trim() || saving}
            onClick={() => void submit()}
          >
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
