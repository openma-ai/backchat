import {
  CameraIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  RotateCwIcon,
  SearchIcon,
  Settings2Icon,
  SmartphoneIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import type { BrowserDataPanel } from "@/components/shell/BrowserDataDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function BrowserMenu({
  zoomFactor,
  canOpenExternal,
  onOpenFind,
  onPrintPage,
  onChangeZoom,
  onResetZoom,
  onShowDeviceToolbar,
  onCaptureScreenshot,
  onReload,
  onCopyAddress,
  onOpenExternal,
  onOpenPanel,
  onOpenSettings,
}: {
  zoomFactor: number;
  canOpenExternal: boolean;
  onOpenFind(): void;
  onPrintPage(): void;
  onChangeZoom(delta: number): void;
  onResetZoom(): void;
  onShowDeviceToolbar(): void;
  onCaptureScreenshot(): void;
  onReload(): void;
  onCopyAddress(): void;
  onOpenExternal(): void;
  onOpenPanel(panel: Exclude<BrowserDataPanel, null>): void;
  onOpenSettings(): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Browser menu"
          title="Browser menu"
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
            "text-fg-muted hover:bg-bg-surface/60 hover:text-fg",
            "transition-colors",
          )}
        >
          <EllipsisVerticalIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-64 p-1.5">
        <DropdownMenuItem onSelect={onOpenFind} className="h-8 gap-2 text-xs">
          <SearchIcon className="size-3.5" />
          <span>Find in page</span>
          <span className="ml-auto text-[10px] text-fg-subtle">⌘F</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPrintPage} className="h-8 gap-2 text-xs">
          <PrinterIcon className="size-3.5" />
          Print
        </DropdownMenuItem>
        <div className="flex h-9 items-center gap-2 px-1.5 text-xs text-fg">
          <span className="mr-auto">Zoom</span>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onChangeZoom(-0.1)}
            className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-surface hover:text-fg"
          >
            <MinusIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            onClick={onResetZoom}
            className="min-w-10 rounded-md px-1 py-1 tabular-nums text-fg-muted hover:bg-bg-surface hover:text-fg"
          >
            {Math.round(zoomFactor * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onChangeZoom(0.1)}
            className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-bg-surface hover:text-fg"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onShowDeviceToolbar}
          className="h-8 gap-2 text-xs"
        >
          <SmartphoneIcon className="size-3.5" />
          Show device toolbar
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onCaptureScreenshot}
          className="h-8 gap-2 text-xs"
        >
          <CameraIcon className="size-3.5" />
          Capture screenshot
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReload} className="h-8 gap-2 text-xs">
          <RotateCwIcon className="size-3.5" />
          Reload page
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyAddress} className="h-8 gap-2 text-xs">
          <CopyIcon className="size-3.5" />
          Copy address
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onOpenExternal}
          disabled={!canOpenExternal}
          className="h-8 gap-2 text-xs"
        >
          <ExternalLinkIcon className="size-3.5" />
          Open in default browser
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onOpenPanel("import")}
          className="h-8 gap-2 text-xs"
        >
          <UploadIcon className="size-3.5" />
          Import cookies and passwords…
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onOpenPanel("passwords")}
          className="h-8 gap-2 text-xs"
        >
          <KeyRoundIcon className="size-3.5" />
          Passwords and autofill
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onOpenPanel("downloads")}
          className="h-8 gap-2 text-xs"
        >
          <DownloadIcon className="size-3.5" />
          Downloads
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onOpenPanel("clear-data")}
          className="h-8 gap-2 text-xs"
        >
          <Trash2Icon className="size-3.5" />
          Clear browsing data
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings} className="h-8 gap-2 text-xs">
          <Settings2Icon className="size-3.5" />
          Browser settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
