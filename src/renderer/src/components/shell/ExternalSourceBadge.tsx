import { useI18n } from "@/lib/i18n";

/** Small source mark for a session or project work item created outside the GUI. */
export function ExternalSourceBadge({
  client,
  variant = "session",
}: {
  client: string;
  variant?: "session" | "coordinator";
}) {
  const { t } = useI18n();
  const label = variant === "coordinator"
    ? t("project.externalCoordinator", { client })
    : t("session.externalSource", { client });
  return (
    <span
      data-testid="external-source-badge"
      title={label}
      className="max-w-[4.75rem] min-w-0 shrink truncate rounded bg-bg-surface px-1 py-px text-[10px] leading-4 text-fg-subtle"
    >
      {label}
    </span>
  );
}
