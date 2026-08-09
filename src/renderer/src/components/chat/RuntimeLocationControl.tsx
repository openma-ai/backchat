import {
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  MonitorIcon,
  ServerIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function RuntimeLocationControl({
  title,
  className,
}: {
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-composer-footer-control="runtime"
          data-session-runtime-location="true"
          className={cn(
            "app-compact-control runtime-location-control min-w-0 bg-transparent",
            className,
          )}
          title={title ?? t("chat.whereRuns")}
        >
          <span data-control-icon>
            <MonitorIcon />
          </span>
          <span className="truncate">{t("chat.local")}</span>
          <ChevronDownIcon data-control-chevron />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[var(--composer-menu-width)]"
      >
        <DropdownMenuItem className="flex items-center gap-2 text-xs">
          <MonitorIcon className="size-3.5 text-fg-subtle" />
          <span className="flex-1">{t("chat.local")}</span>
          <CheckIcon className="size-3.5 text-fg-muted" />
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled
          className="flex items-start gap-2 text-xs opacity-60"
        >
          <CloudIcon className="mt-0.5 size-3.5 text-fg-subtle" />
          <div className="min-w-0 flex-1">
            <div>{t("chat.cloud")}</div>
            <div className="text-[11px] text-fg-subtle">
              {t("chat.comingSoon")}
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled
          className="flex items-start gap-2 text-xs opacity-60"
        >
          <ServerIcon className="mt-0.5 size-3.5 text-fg-subtle" />
          <div className="min-w-0 flex-1">
            <div>{t("chat.otherMachine")}</div>
            <div className="text-[11px] text-fg-subtle">
              {t("chat.notConnected")}
            </div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
