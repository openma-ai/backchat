import { useEffect, useState } from "react";
import { TargetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

/** Editing a goal is a decision, not a draft. It commits on Save rather than
 * reusing the composer, so the message being written is not displaced and
 * closing the dialog changes nothing. */
export function GoalEditDialog({
  objective,
  open,
  onOpenChange,
  onSave,
}: {
  objective: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (objective: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(objective);
  useEffect(() => {
    if (open) setValue(objective);
  }, [objective, open]);

  const trimmed = value.trim();
  const save = () => {
    if (!trimmed || trimmed === objective.trim()) {
      onOpenChange(false);
      return;
    }
    onSave(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-goal-edit-dialog="true">
        <DialogHeader>
          <span className="grid size-9 place-items-center rounded-xl bg-bg-surface text-fg-muted">
            <TargetIcon className="size-4" aria-hidden="true" />
          </span>
          <DialogTitle>{t("chat.editProgress")}</DialogTitle>
        </DialogHeader>
        <textarea
          data-goal-edit-input="true"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={6}
          autoFocus
          // Codex caps goal text at 4000 characters and answers a longer one
          // with an error turn, so the limit belongs on the input.
          maxLength={4000}
          className="w-full resize-none rounded-xl border border-ring bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-ring"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            data-goal-edit-save="true"
            className="rounded-full"
            disabled={!trimmed}
            onClick={save}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
