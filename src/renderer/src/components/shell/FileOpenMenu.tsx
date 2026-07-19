import {
  ChevronDownIcon,
  FolderOpenIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function FileOpenMenu({
  path,
  onOpenDefault,
  onReveal,
}: {
  path: string;
  onOpenDefault(): void;
  onReveal(): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Open ${path}`}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70",
            "bg-bg-surface px-2.5 text-xs font-medium text-fg shadow-sm",
            "hover:bg-bg-surface/80 transition-colors",
          )}
        >
          Open in
          <ChevronDownIcon className="size-3.5 text-fg-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-52 p-1.5">
        <DropdownMenuItem onSelect={onOpenDefault} className="h-8 gap-2 text-xs">
          <SquareArrowOutUpRightIcon className="size-3.5" />
          Default app
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReveal} className="h-8 gap-2 text-xs">
          <FolderOpenIcon className="size-3.5" />
          Show in Finder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
