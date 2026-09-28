import type { FormEvent, ReactNode } from "react";
import { Dialog, DialogTitle, DialogDescription } from "./dialog";
import { PopupContent, PopupHeader, PopupBody } from "./popup";

/** Shared form shell: only the body scrolls; title and actions remain reachable. */
export function FormDialog({
  title,
  description,
  children,
  actions,
  error,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  children: ReactNode;
  actions: ReactNode;
  error?: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <PopupContent showCloseButton={!busy}>
        <PopupHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </PopupHeader>
        <form onSubmit={onSubmit} className="min-h-0 min-w-0">
          <PopupBody>
            <div className="px-5 pb-5">{children}</div>
          </PopupBody>
          <div className="border-t border-border px-5 py-3">
            {error ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">{actions}</div>
          </div>
        </form>
      </PopupContent>
    </Dialog>
  );
}
