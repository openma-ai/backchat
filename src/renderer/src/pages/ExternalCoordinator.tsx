import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CoordinatorSiblings } from "@/components/shell/CoordinatorSiblings";
import { PageTopbar } from "@/components/shell/PageTopbar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { selectSessions, useSessionStore } from "@/lib/session-store";
import type { ExternalTaskInfo } from "@shared/external-coordinator";
import "./projects.css";

/** View for one external coordinator. It lists the work and sessions that
 *  client submitted. There is no in-app model, so the composer is read-only. */
export function ExternalCoordinatorPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const { projectId, coordinatorId } = useParams({ strict: false }) as {
    projectId?: string;
    coordinatorId?: string;
  };
  const sessions = useSessionStore(selectSessions);
  const workspace = useQuery({
    queryKey: ["project-work", projectId],
    queryFn: () => window.backchat.projectWorkView(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const coordinator = workspace.data?.external_coordinators?.find((item) => item.id === coordinatorId);
  const tasks = (workspace.data?.external_tasks ?? []).filter((task) => task.coordinator_id === coordinatorId);
  const threads = sessions.filter((session) =>
    session.projectId === projectId && session.externalClient === coordinator?.name
  );
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [steer, setSteer] = useState<{ sessionId: string; text: string } | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [deleteThreads, setDeleteThreads] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const task = tasks.find((item) => item.id === selectedTask) ?? null;

  const remove = async () => {
    if (!coordinator) return;
    setBusy(true);
    setError("");
    try {
      await window.backchat.externalCoordinatorRemove({
        id: coordinator.id,
        delete_threads: deleteThreads,
      });
      await cache.invalidateQueries({ queryKey: ["external-coordinators"] });
      await cache.invalidateQueries({ queryKey: ["project-work", projectId] });
      await navigate({ to: "/projects/$projectId", params: { projectId: projectId! } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!projectId || !coordinatorId) return null;
  if (workspace.isPending) {
    return <div className="project-loading" role="status">{t("project.openingCoordinator")}</div>;
  }
  if (!coordinator) {
    return (
      <div className="projects-empty">
        <h2>{t("project.externalCoordinatorMissing")}</h2>
        <Link to="/projects/$projectId" params={{ projectId }}>{t("project.coordinator")}</Link>
      </div>
    );
  }

  return (
    <div className="projects-page">
      <PageTopbar>
        <div className="app-no-drag flex min-w-0 flex-1 items-center gap-2 text-ui">
          <div className="min-w-0 flex-1 truncate font-medium">
            {t("project.externalCoordinatorEntry", { client: coordinator.name })}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setRemoveOpen(true)}>
            {t("project.removeExternalCoordinator")}
          </Button>
        </div>
      </PageTopbar>
      <div className="project-columns project-panel-open">
        <section className="project-main">
          <CoordinatorSiblings
            projectId={projectId}
            active={coordinator.id}
            coordinators={workspace.data?.external_coordinators ?? []}
          />
          <div className="project-knowledge">
            <h2>{task ? task.text : t("project.externalSubmitted")}</h2>
            {task ? (
              <p className="project-worker-attribution" data-testid="task-attribution">
                {t("project.externalCoordinator", { client: task.coordinator_name })}
              </p>
            ) : (
              <p>{t("project.externalSubmittedHint")}</p>
            )}
            <div className="project-external-composer">
              <Textarea
                readOnly
                aria-label={t("project.externalComposerNote")}
                placeholder={t("project.externalComposerNote")}
                value=""
              />
            </div>
            {error ? <p role="alert" className="project-error">{error}</p> : null}
          </div>
        </section>
        <aside className="project-side-panel" aria-label={t("project.threads")}>
          <div className="project-side-heading">
            <h2>{t("project.threads")}</h2>
          </div>
          <div className="project-work-list">
            {threads.length + tasks.length === 0 ? (
              <div className="project-workers-empty">
                <h3>{t("project.tasksAppearHere")}</h3>
                <p>{t("project.externalThreadsEmpty")}</p>
              </div>
            ) : null}
            {threads.map((session) => (
              <article className="project-worker" key={session.id}>
                <div>
                  <p className="project-worker-title">{session.label}</p>
                  <p className="project-worker-attribution" data-testid="task-attribution">
                    {t("project.externalCoordinator", { client: coordinator.name })}
                  </p>
                </div>
                <div className="project-worker-actions">
                  <Button size="sm" variant="outline" onClick={() => setSteer({ sessionId: session.id, text: "" })}>
                    {t("project.steer")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void navigate({ to: "/chat/$sessionId", params: { sessionId: session.id } })}
                  >
                    {t("project.viewThread")}
                  </Button>
                </div>
              </article>
            ))}
            {tasks.map((item) => (
              <TaskRow
                key={item.id}
                task={item}
                onView={() => setSelectedTask(item.id)}
              />
            ))}
          </div>
        </aside>
      </div>
      {steer ? (
        <div className="project-external-steer" role="dialog" aria-label={t("project.steer")}>
          <Textarea
            autoFocus
            value={steer.text}
            aria-label={t("project.steer")}
            onChange={(event) => setSteer({ ...steer, text: event.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSteer(null)}>{t("common.cancel")}</Button>
            <Button
              size="sm"
              disabled={!steer.text.trim() || busy}
              onClick={() => {
                const text = steer.text.trim();
                const sessionId = steer.sessionId;
                setBusy(true);
                void window.backchat.sessionPrompt({
                  session_id: sessionId,
                  turn_id: crypto.randomUUID(),
                  text,
                }).then(() => {
                  setSteer(null);
                  void navigate({ to: "/chat/$sessionId", params: { sessionId } });
                }).catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }).finally(() => setBusy(false));
              }}
            >
              {t("project.steer")}
            </Button>
          </div>
        </div>
      ) : null}
      {removeOpen ? (
        <div className="project-external-steer" role="dialog" aria-label={t("project.removeExternalCoordinator")}>
          <h2>{t("project.removeExternalCoordinator")}</h2>
          <p>{t("project.removeExternalCoordinatorBody")}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={deleteThreads}
              onChange={(event) => setDeleteThreads(event.target.checked)}
            />
            {t("project.deleteExternalThreads")}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRemoveOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
              {t("project.removeExternalCoordinator")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskRow({ task, onView }: { task: ExternalTaskInfo; onView: () => void }) {
  const { t } = useI18n();
  return (
    <article className="project-worker" data-testid="external-task">
      <div>
        <button type="button" className="project-worker-title" onClick={onView}>
          {task.text}
        </button>
        <p className="project-worker-attribution" data-testid="task-attribution">
          {t("project.externalCoordinator", { client: task.coordinator_name })}
        </p>
      </div>
      <div className="project-worker-actions">
        <Button size="sm" variant="ghost" onClick={onView}>{t("project.viewThread")}</Button>
      </div>
    </article>
  );
}
