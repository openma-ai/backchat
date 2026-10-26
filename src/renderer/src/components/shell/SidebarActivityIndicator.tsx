import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, ShieldAlertIcon } from "@/components/Icons";
import { useI18n } from "@/lib/i18n";
import type { SidebarActivityStatus } from "@/lib/sidebar-activity";

/** Shares the final grid cell with the hover menu; hidden controls never push it left. */
export function SidebarActivityIndicator({ status }: { status: SidebarActivityStatus }) {
  const { t } = useI18n();
  if (status === "idle") return null;
  const label = t(`sidebar.activity.${status}`);
  return (
    <span role="img" aria-label={label} title={label}
      data-sidebar-activity={status}
      data-sidebar-unread-indicator={status === "unread" ? "true" : undefined}
      data-sidebar-grid-action="last"
      className="sidebar-row-action sidebar-row-rest sidebar-activity-indicator pointer-events-none">
      {status === "running" ? <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : status === "approval" ? <ShieldAlertIcon aria-hidden="true" />
        : status === "error" ? <CircleAlertIcon aria-hidden="true" />
        : <CircleCheckIcon aria-hidden="true" />}
    </span>
  );
}
