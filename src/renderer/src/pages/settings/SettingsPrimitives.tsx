import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Native <select> styled like the compact SelectTrigger. Native keeps
 *  `selectOption` working for e2e and gives the OS picker on macOS. */
export const SETTINGS_SELECT_CLASS =
  "block h-8 w-full appearance-none rounded-md border border-border/55 bg-bg px-2.5 pr-8 text-xs text-fg shadow-xs outline-none "
  + "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23888%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[position:right_8px_center] bg-no-repeat "
  + "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/** Settings page primitives shared by the account/connection pages. They
 *  mirror the Browser page: an eyebrow heading, one bordered card per group,
 *  12px labels, compact controls. */

export function SettingsSection({
  title,
  icon,
  description,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
        {icon}
        {title}
      </h2>
      {description && (
        <p className="mb-2 max-w-[68ch] text-xs leading-5 text-fg-muted">{description}</p>
      )}
      {children}
    </section>
  );
}

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border border-border/55 bg-bg/72 p-3.5 shadow-card-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Stacked label + control. `hint` sits under the control in the subtle tone. */
export function SettingsField({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-4 text-fg-subtle">{hint}</span>}
    </label>
  );
}

/** A row inside a card list: title/description on the left, actions right. */
export function SettingsListRow({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/55 bg-bg px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-fg">{title}</div>
        {description && (
          <div className="mt-0.5 truncate text-[11px] text-fg-muted">{description}</div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
