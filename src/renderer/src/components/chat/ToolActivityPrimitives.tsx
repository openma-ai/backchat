import {
  BrainIcon,
  FileEditIcon,
  FileTextIcon,
  FolderTreeIcon,
  GlobeIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function pickToolIcon(kind?: string): typeof FileTextIcon {
  switch (kind) {
    case "read":
      return FileTextIcon;
    case "edit":
      return FileEditIcon;
    case "search":
    case "grep":
      return SearchIcon;
    case "execute":
    case "terminal":
      return TerminalIcon;
    case "fetch":
    case "web":
      return GlobeIcon;
    case "think":
      return BrainIcon;
    case "list":
    case "tree":
      return FolderTreeIcon;
    default:
      return WrenchIcon;
  }
}

export function toolSurfaceLabel(kind?: string): string {
  switch (kind) {
    case "execute":
    case "terminal":
      return "Terminal";
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "search":
    case "grep":
      return "Search";
    case "fetch":
    case "web":
      return "Web";
    default:
      return "Tool";
  }
}

export function ToolActivityIdentity({
  kind,
  label,
  target,
  trailing,
  failed = false,
  leading,
}: {
  kind?: string;
  label: string;
  target?: string;
  trailing?: ReactNode;
  failed?: boolean;
  leading?: ReactNode;
}) {
  const Icon = pickToolIcon(kind);
  return (
    <span className="contents" data-tool-activity-identity={kind ?? "tool"}>
      {leading ?? (
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            failed ? "text-danger" : "text-fg-muted",
          )}
        />
      )}
      <span className={cn("shrink-0", failed ? "text-danger" : "text-fg-muted")}>
        {label}
      </span>
      {target && (
        <span className="min-w-0 truncate text-fg-muted/80" title={target}>
          {target}
        </span>
      )}
      {trailing}
    </span>
  );
}

export function ToolInputBlock({
  id,
  variant = "activity",
  children,
}: {
  id: string;
  variant?: "activity" | "approval";
  children: ReactNode;
}) {
  return (
    <pre
      className={cn(
        "max-h-28 overflow-auto font-mono whitespace-pre-wrap break-words text-fg-muted",
        variant === "activity"
          ? "ml-5 mt-1 rounded bg-bg-surface/45 px-2 py-1 text-[11px]"
          : "mt-4 px-2 py-1 text-[12px] leading-6 text-fg-subtle",
      )}
      data-tool-input={id}
    >
      {children}
    </pre>
  );
}
