import {
  ChevronDownIcon,
  FolderOpenIcon,
  SquareArrowOutUpRightIcon,
} from "@/components/Icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GAP_ADJACENT_PX } from "@/components/ui/gap-adjacent";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function FileOpenMenu({
  path,
  onOpenDefault,
  onReveal,
}: {
  path: string;
  onOpenDefault(): void;
  onReveal(): void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Open ${path}`}
          // The file surface's one primary action: solid ink, same height as
          // the chrome controls so it lines up with the panel toggle above.
          className={cn(
            "inline-flex h-[var(--chrome-size)] shrink-0 items-center gap-1.5 rounded-lg",
            "bg-fg px-2.5 text-xs font-medium text-bg",
            "hover:bg-fg/85 transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "data-[state=open]:bg-fg/85",
          )}
        >
          Open in
          <ChevronDownIcon className="size-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={GAP_ADJACENT_PX} className="w-52 p-1.5">
        <DropdownMenuItem onSelect={onOpenDefault} className="h-8 gap-2 text-xs">
          <SquareArrowOutUpRightIcon className="size-3.5" />
          Default app
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReveal} className="h-8 gap-2 text-xs">
          <FolderOpenIcon className="size-3.5" />
          {t("file.reveal")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
