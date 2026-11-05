import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import type { RelatedReview } from "@/lib/related-reviews";
import { formatScheduleFrequency } from "@/lib/scheduled-task-presentation";
import type { ScheduleInfo } from "@shared/schedules";

export function ProjectOverviewTabs({ hasPullRequests }: { hasPullRequests: boolean }) {
  const { t } = useI18n();
  return <TabsList aria-label={t("project.views")} className="project-panel-tabs">
    <TabsTrigger value="workers">{t("project.workers")}</TabsTrigger>
    <TabsTrigger value="library">{t("project.library")}</TabsTrigger>
    {hasPullRequests ? <TabsTrigger value="pull-requests">{t("project.pullRequests")}</TabsTrigger> : null}
    <TabsTrigger value="routine">{t("project.routine")}</TabsTrigger>
  </TabsList>;
}

export function ProjectPullRequests({ reviews }: { reviews: RelatedReview[] }) {
  return <div className="project-work-list">
    {reviews.map(review => <article className="project-worker" key={review.url}>
      <a href={review.url} target="_blank" rel="noreferrer" className="project-review-link">
        {review.repository} · {review.kind} #{review.number}
      </a>
    </article>)}
  </div>;
}

export function ProjectRoutines({ routines, pending, error }: {
  routines: ScheduleInfo[]; pending: boolean; error: Error | null;
}) {
  const { t, locale } = useI18n();
  return <div className="project-work-list">
    {error ? <p role="alert">{error.message}</p> : null}
    {pending ? <p role="status">{t("project.loadingRoutines")}</p> : null}
    {!pending && !error && !routines.length ? <p className="project-help">{t("project.noRoutines")}</p> : null}
    {routines.map(routine => <article className="project-routine" key={routine.id}>
      <h3>{routine.name}</h3>
      <p>{formatScheduleFrequency(routine.trigger, locale)}
        {"timezone" in routine.trigger ? ` · ${routine.trigger.timezone}` : ""} · {routine.status}</p>
      <dl>
        <dt>{t("project.nextRun")}</dt><dd>{routine.nextRunAt == null ? "—" : new Date(routine.nextRunAt).toLocaleString(locale)}</dd>
        <dt>{t("project.lastRun")}</dt><dd>{routine.lastRunAt == null ? "—" : new Date(routine.lastRunAt).toLocaleString(locale)}</dd>
      </dl>
    </article>)}
  </div>;
}
