import {
  DownloadIcon,
  KeyRoundIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import type {
  BrowserClearDataKind,
  BrowserCredentialSummary,
  BrowserDownloadInfo,
} from "@shared/browser-data.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BrowserDataPanel =
  | "import"
  | "passwords"
  | "downloads"
  | "clear-data"
  | null;

export function BrowserDataDialog({
  panel,
  downloads,
  credentials,
  clearKinds,
  onClose,
  onClearKindsChange,
  onFillCredential,
  onDeleteCredential,
  onRevealDownload,
  onClearData,
}: {
  panel: BrowserDataPanel;
  downloads: BrowserDownloadInfo[];
  credentials: BrowserCredentialSummary[];
  clearKinds: BrowserClearDataKind[];
  onClose(): void;
  onClearKindsChange(kinds: BrowserClearDataKind[]): void;
  onFillCredential(credentialId: string): void;
  onDeleteCredential(credentialId: string): void;
  onRevealDownload(downloadId: string): void;
  onClearData(): void;
}) {
  return (
    <Dialog
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        {panel === "import" && (
          <>
            <DialogHeader className="border-b border-border/60 p-4">
              <DialogTitle>Import cookies and passwords</DialogTitle>
              <DialogDescription>
                Import from an installed browser profile. Exported cookie or password files are not accepted.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 p-4 text-xs text-fg-muted">
              <div className="rounded-lg border border-border/60 bg-bg-surface/40 p-3">
                <div className="flex items-center gap-2 text-fg">
                  <UploadIcon className="size-4" />
                  <span className="font-medium">System browser profiles</span>
                </div>
                <p className="mt-1.5 leading-5">
                  Profile migration is scoped to local browser data and will never read an exported file.
                </p>
              </div>
              <p>Install or sign in to a supported browser first, then run the migration from this panel.</p>
            </div>
            <DialogFooter className="border-t border-border/60 p-3">
              <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
        {panel === "passwords" && (
          <>
            <DialogHeader className="border-b border-border/60 p-4">
              <DialogTitle>Passwords and autofill</DialogTitle>
              <DialogDescription>
                Saved credentials stay in the main process and are only filled after you choose them.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 overflow-y-auto p-3">
              {credentials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 p-5 text-center text-xs text-fg-muted">
                  No saved passwords in this browser profile.
                </div>
              ) : (
                <div className="space-y-1">
                  {credentials.map((credential) => (
                    <div key={credential.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-bg-surface/60">
                      <KeyRoundIcon className="size-4 shrink-0 text-fg-subtle" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-fg">{credential.origin}</div>
                        <div className="truncate text-[11px] text-fg-muted">{credential.username}</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onFillCredential(credential.id)}
                      >
                        Fill
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${credential.origin}`}
                        onClick={() => onDeleteCredential(credential.id)}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {panel === "downloads" && (
          <>
            <DialogHeader className="border-b border-border/60 p-4">
              <DialogTitle>Downloads</DialogTitle>
              <DialogDescription>Files downloaded by the in-app browser.</DialogDescription>
            </DialogHeader>
            <div className="max-h-72 overflow-y-auto p-3">
              {downloads.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 p-5 text-center text-xs text-fg-muted">
                  No downloads yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {downloads.map((download) => (
                    <div key={download.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-bg-surface/60">
                      <DownloadIcon className="size-4 shrink-0 text-fg-subtle" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-fg">{download.fileName}</div>
                        <div className="truncate text-[11px] text-fg-muted">{download.state}</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onRevealDownload(download.id)}
                      >
                        Show
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {panel === "clear-data" && (
          <>
            <DialogHeader className="border-b border-border/60 p-4">
              <DialogTitle>Clear browsing data</DialogTitle>
              <DialogDescription>Choose what to remove from this browser profile.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 p-4">
              {([
                ["history", "Browsing history"],
                ["cookies", "Cookies and site data"],
                ["cache", "Cached images and files"],
                ["passwords", "Saved passwords"],
              ] as const).map(([kind, label]) => (
                <label key={kind} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs text-fg">
                  <Checkbox
                    checked={clearKinds.includes(kind)}
                    onCheckedChange={(checked) => onClearKindsChange(checked
                      ? [...new Set([...clearKinds, kind])]
                      : clearKinds.filter((candidate) => candidate !== kind))}
                  />
                  {label}
                </label>
              ))}
            </div>
            <DialogFooter className="border-t border-border/60 p-3">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="button" onClick={onClearData} disabled={clearKinds.length === 0}>Clear data</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
