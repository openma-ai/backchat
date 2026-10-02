import { Link } from "@tanstack/react-router";
import { CoordinationIcon as WorkflowIcon } from "@/components/BackchatIcons";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ExternalCoordinatorInfo } from "@shared/external-coordinator";

/** Built-in and external coordinators as sibling rows. Selecting one opens
 *  that coordinator's view. Neither row configures the other. */
export function CoordinatorSiblings({
  projectId,
  active,
  coordinators,
}: {
  projectId: string;
  active: "builtin" | string;
  coordinators: readonly ExternalCoordinatorInfo[];
}) {
  const { t } = useI18n();
  return (
    <nav className="coordinator-siblings" aria-label={t("project.coordinators")}>
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        data-project-coordinator={`project:${projectId}`}
        data-testid="project-coordinator-row"
        aria-current={active === "builtin" ? "page" : undefined}
        className={cn("sidebar-coordinator-row", active === "builtin" && "app-selected-surface")}
      >
        <span className="sidebar-coordinator-icon">
          <WorkflowIcon className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{t("project.coordinator")}</span>
      </Link>
      {coordinators.map((coordinator) => (
        <Link
          key={coordinator.id}
          to="/projects/$projectId/coordinators/$coordinatorId"
          params={{ projectId, coordinatorId: coordinator.id }}
          data-testid="external-coordinator-row"
          data-external-coordinator={coordinator.name}
          aria-current={active === coordinator.id ? "page" : undefined}
          className={cn("sidebar-coordinator-row", active === coordinator.id && "app-selected-surface")}
        >
          <span className="sidebar-coordinator-icon">
            <WorkflowIcon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">
            {t("project.externalCoordinatorEntry", { client: coordinator.name })}
          </span>
        </Link>
      ))}
    </nav>
  );
}
