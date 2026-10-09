import { useProjects } from "@/lib/projects-query";
import { useI18n } from "@/lib/i18n";
import { ExternalSourceBadge } from "@/components/shell/ExternalSourceBadge";
import { defaultCoordinatorConfig as defaults } from "@/lib/project-coordinator";
import { PageTopbar } from "@/components/shell/PageTopbar";
import type { PromptAttachment } from "@shared/session-events";
import { ProjectMessageAttachments } from "@/components/chat/ProjectMessageAttachments";
import { projectResponseText } from "@shared/project-transcript";
import { useState, useRef } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  SettingsIcon,
  ListTodoIcon,
  FolderIcon,
  PlusIcon,
  PencilIcon,
  FileTextIcon,
  XIcon,
  CheckIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  CloudIcon,
  MonitorIcon,
} from "@/components/Icons";
import { AgentIcon } from "@/components/AgentIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StreamdownText } from "@/components/chat/ChatMarkdown";
import type { ProjectInfo } from "@shared/projects";
import type {
  ProjectWorkConfig,
  ProjectWorkCommand,
  ProjectWorkView,
} from "@shared/project-work";
import { GroupedCommandField } from "@/components/ui/grouped-command-field";
import { useSettings } from "@/lib/settings-store";
import { enabledAgentIds, isAgentRunnable } from "@/lib/enabled-agents";
import {
  projectGoalPresentation,
  projectOutcomeLabel,
  projectThreads,
  projectCoordinatorTurns,
} from "@/lib/project-goals";
import { ProjectComposer } from "@/components/chat/ProjectComposer";
import { ProjectConversation } from "@/components/chat/ProjectConversation";
import { FormDialog } from "@/components/ui/form-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CreateProjectDialog,
  ProjectFolderList,
} from "@/components/shell/CreateProjectDialog";
import "./projects.css";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ProjectsPage() {
  const { t } = useI18n();
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const projects = useProjects();
  const workspace = useQuery({
    queryKey: ["project-work", projectId],
    queryFn: () => window.backchat.projectWorkView(projectId!),
    enabled: !!projectId,
    refetchInterval: 1500,
  });
  const project = workspace.data?.project;
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["projects"] }),
      cache.invalidateQueries({ queryKey: ["project-work", projectId] }),
    ]);
  };
  if (projectId && workspace.isPending)
    return (
      <div className="project-loading" role="status">
        Opening project…
      </div>
    );
  return (
    <div className="projects-page">
      {workspace.error && projectId ? (
        <div role="alert" className="project-error">
          {errorText(workspace.error)}{" "}
          <Link to="/projects">Back to projects</Link>
        </div>
      ) : null}
      {!projectId ? (
        <div className="projects-index">
          <header className="projects-list-header">
            <div>
              <h1>Projects</h1>
              <p>Keep your conversations, knowledge, and work together.</p>
            </div>
            <Button onClick={() => setEditing(true)}>
              <PlusIcon />
              New project
            </Button>
          </header>
          <Input
            className="projects-search"
            aria-label={t("project.searchProjects")}
            placeholder={t("project.searchProjectsPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {projects.error ? (
            <p role="alert">{errorText(projects.error)}</p>
          ) : null}
          {projects.isPending ? (
            <p role="status">Loading projects…</p>
          ) : (
            <div className="projects-grid">
              {projects.data
                ?.filter((p) =>
                  p.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((p) => (
                  <Link
                    key={p.id}
                    to="/projects/$projectId"
                    params={{ projectId: p.id }}
                    className="project-card"
                  >
                    <FolderIcon className="size-5" />
                    <h2>{p.name}</h2>
                    <p>
                      {p.primary_folder ||
                        "Conversations and project knowledge"}
                    </p>
                    <span>
                      Updated {new Date(p.updated_at).toLocaleDateString()}
                    </span>
                  </Link>
                ))}
            </div>
          )}
          {!projects.isPending && !projects.data?.length ? (
            <div className="projects-empty">
              <FolderIcon className="size-9" />
              <h2>A place for work that continues</h2>
              <p>
                Create a project, add what your agents should know, and start a
                conversation.
              </p>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Create your first project
              </Button>
            </div>
          ) : null}
          {projects.data?.length &&
          !projects.data.some((p) =>
            p.name.toLowerCase().includes(search.toLowerCase()),
          ) ? (
            <p className="projects-empty">No projects match “{search}”.</p>
          ) : null}
        </div>
      ) : workspace.data ? (
        <>
          <ProjectWorkspace
            key={projectId}
            view={workspace.data}
            refresh={refresh}
            edit={() => void navigate({ to: "/settings/projects/$projectId", params: { projectId: projectId! } })}
          />
        </>
      ) : null}
      {editing && !projectId ? (
        <CreateProjectDialog
          open={editing}
          onOpenChange={setEditing}
          onCreated={(created) => {
            void refresh();
            void navigate({
              to: "/projects/$projectId",
              params: { projectId: created.id },
            });
          }}
        />
      ) : editing && project ? (
        <ProjectEditor
          project={project}
          config={workspace.data?.config ?? undefined}
          close={() => setEditing(false)}
          removed={async () => {
            setEditing(false);
            await navigate({ to: "/projects" });
            cache.removeQueries({ queryKey: ["project-work", projectId] });
            await cache.invalidateQueries({ queryKey: ["projects"] });
          }}
          saved={async (id) => {
            setEditing(false);
            await refresh();
            await navigate({
              to: "/projects/$projectId",
              params: { projectId: id },
            });
          }}
        />
      ) : null}
    </div>
  );
}

export function ProjectEditor({
  removed,
  project,
  config,
  close,
  saved,
}: {
  removed: () => Promise<void>;
  project?: ProjectInfo;
  config?: ProjectWorkConfig;
  close: () => void;
  saved: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const creating = !project;
  const [draft, setDraft] = useState<ProjectWorkConfig>(
    () => config ?? defaults(project?.id ?? `proj-${crypto.randomUUID()}`),
  );
  const [name, setName] = useState(project?.name ?? "");
  const [folders, setFolders] = useState(() => [
    ...new Set(
      [project?.primary_folder, ...(project?.source_folders ?? [])].filter(
        (p): p is string => !!p,
      ),
    ),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState("general");
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.backchat.agentsList(),
    enabled: !creating,
  });
  const account = useQuery({
    queryKey: ["openma-account"],
    queryFn: () => window.backchat.openmaAccountState(),
    enabled: !creating,
  });
  const cloud = draft.execution?.kind === "cloud";
  const catalog = useQuery({
    queryKey: ["project-cloud-catalog", draft.execution],
    queryFn: () =>
      window.backchat.openmaCatalog(
        draft.execution?.kind === "cloud" ? draft.execution : undefined,
      ),
    enabled: !creating && cloud,
  });
  const settings = useSettings();
  const enabledIds = enabledAgentIds(settings);
  const available = cloud
    ? catalog.data?.cloudAgents.map((a) => ({
        id: a.id,
        label: a.name,
        detected: true,
      }))
    : agents.data?.filter(
        (agent) =>
          enabledIds.has(agent.id) &&
          isAgentRunnable(agent),
      );
  const field = <K extends keyof ProjectWorkConfig>(
    key: K,
    value: ProjectWorkConfig[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));
  const addFolders = async () => {
    try {
      const selected = await window.backchat.uiFsPickDirs();
      setFolders((current) => [...new Set([...current, ...selected])]);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (
        !creating &&
        (!available?.some((a) => a.id === draft.coordinatorAgent) ||
          !available?.some((a) => a.id === draft.workerAgent))
      ) {
        setSection("agents");
        throw new Error(
          "Choose a set-up coordinator and worker agent to finish setup.",
        );
      }
      if (
        cloud &&
        (!draft.coordinatorEnvironment || !draft.workerEnvironment)
      ) {
        setSection("agents");
        throw new Error("Choose an environment for both agents.");
      }
      await window.backchat.projectSave({
        project_id: draft.projectId,
        name: name.trim(),
        source_folders: folders,
        primary_folder: folders[0] ?? "",
      });
      await window.backchat.projectWorkSave(draft);
      await saved(draft.projectId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const basics = (
    <div className="space-y-5">
      <label className="grid gap-2 text-sm font-medium">
        Project name
        <Input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Improve checkout"
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        <span>
          Goal{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <Textarea
          aria-label={t("project.goalLabel")}
          rows={3}
          value={draft.description}
          onChange={(e) => field("description", e.target.value)}
          placeholder={t("project.goalPlaceholder")}
          className="resize-none"
        />
      </label>
    </div>
  );
  const folderPicker = (
    <ProjectFolderList
      folders={folders}
      onAdd={() => void addFolders()}
      onMakePrimary={(folder) =>
        setFolders((current) => [
          folder,
          ...current.filter((p) => p !== folder),
        ])
      }
      onRemove={(folder) =>
        setFolders((current) => current.filter((p) => p !== folder))
      }
    />
  );
  return (
    <FormDialog
      title={creating ? "New project" : "Coordinator settings"}
      description={
        creating
          ? "Start with a goal. You can configure your agents later."
          : "Manage your project’s context and execution."
      }
      busy={busy}
      error={error}
      onClose={close}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      actions={
        <>
          {!creating ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto text-muted-foreground"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await window.backchat.projectDelete({
                    project_id: project.id,
                  });
                  await removed();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete project
            </Button>
          ) : null}
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            {creating ? "Create project" : "Save project"}
          </Button>
        </>
      }
    >
      {creating ? (
        <div className="space-y-5">
          {basics}
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Add context <span className="text-xs">(optional)</span>
            </summary>
            <div className="mt-3 space-y-3">
              {folderPicker}
              <Textarea
                aria-label={t("project.contextLabel")}
                rows={3}
                value={draft.context}
                onChange={(e) => field("context", e.target.value)}
                placeholder={t("project.contextPlaceholder")}
              />
            </div>
          </details>
        </div>
      ) : (
        <Tabs value={section} onValueChange={setSection} className="gap-5">
          <TabsList className="w-full">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="space-y-5">
            {basics}
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Advanced
              </summary>
              <div className="mt-4 space-y-5">
                <GroupedCommandField
                  label="Conversation continuity"
                  searchThreshold={99}
                  value={draft.continuity}
                  onChange={(value) =>
                    field(
                      "continuity",
                      value as ProjectWorkConfig["continuity"],
                    )
                  }
                  options={[
                    {
                      value: "per-scope",
                      label: "Continue across this project",
                    },
                    {
                      value: "per-run",
                      label: "Separate conversations for each run",
                    },
                  ]}
                />
                <fieldset>
                  <legend className="mb-3 text-sm font-medium">
                    Coordinator controls
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {(["delegate", "steer", "cancel", "complete"] as const).map(
                      (control) => (
                        <label
                          key={control}
                          className="flex items-center gap-2 text-sm capitalize"
                        >
                          <Checkbox
                            checked={draft.controls.includes(control)}
                            onCheckedChange={(checked) =>
                              field(
                                "controls",
                                checked === true
                                  ? [...draft.controls, control]
                                  : draft.controls.filter((c) => c !== control),
                              )
                            }
                          />
                          {control}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
              </div>
            </details>
          </TabsContent>
          <TabsContent value="context" className="space-y-5">
            {cloud ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Repositories</p>
                {(draft.repositories ?? []).map((repo, index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-border p-3"
                  >
                    <Input
                      aria-label={`Repository ${index + 1}`}
                      value={repo.url}
                      placeholder="https://github.com/owner/repo"
                      onChange={(e) =>
                        field(
                          "repositories",
                          draft.repositories!.map((r, i) =>
                            i === index ? { ...r, url: e.target.value } : r,
                          ),
                        )
                      }
                    />
                    <div className="flex gap-2">
                      <Input
                        aria-label={`Base reference ${index + 1}`}
                        value={repo.baseRef ?? ""}
                        placeholder={t("project.defaultBranch")}
                        onChange={(e) =>
                          field(
                            "repositories",
                            draft.repositories!.map((r, i) =>
                              i === index
                                ? { ...r, baseRef: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          field(
                            "repositories",
                            draft.repositories!.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={(draft.repositories?.length ?? 0) >= 8}
                  onClick={() =>
                    field("repositories", [
                      ...(draft.repositories ?? []),
                      { url: "" },
                    ])
                  }
                >
                  <PlusIcon />
                  Add repository
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium">Source folders</p>
                {folderPicker}
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Branch settings
                  </summary>
                  <label className="mt-3 grid gap-2 text-sm">
                    Base branch or commit
                    <Input
                      value={draft.baseRef ?? ""}
                      placeholder={t("project.headRef")}
                      onChange={(e) => field("baseRef", e.target.value)}
                    />
                  </label>
                  <p className="mt-2 text-xs text-muted-foreground">
                    New threads start from committed code. Existing threads keep
                    their workspace.
                  </p>
                </details>
              </div>
            )}
            <label className="grid gap-2 text-sm font-medium">
              Instructions
              <Textarea
                rows={3}
                value={draft.instructions}
                onChange={(e) => field("instructions", e.target.value)}
                placeholder={t("project.approachPlaceholder")}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Context
              <Textarea
                rows={3}
                value={draft.context}
                onChange={(e) => field("context", e.target.value)}
                placeholder={t("project.knowledgePlaceholder")}
              />
            </label>
          </TabsContent>
          <TabsContent value="agents" className="space-y-5">
            <GroupedCommandField
              label="Execution location"
              value={cloud ? "cloud" : "local"}
              disabled={!!config?.coordinatorAgent}
              searchThreshold={99}
              options={[
                {
                  value: "local",
                  label: "This computer",
                  leading: <MonitorIcon className="size-3.5" />,
                },
                {
                  value: "cloud",
                  label: "Cloud",
                  leading: <CloudIcon className="size-3.5" />,
                  disabled:
                    account.data?.status !== "signed_in" ||
                    !!account.data.provider,
                },
              ]}
              onChange={(value) => {
                if (value === "local") {
                  setDraft((d) => ({
                    ...d,
                    execution: { kind: "local" },
                    coordinatorAgent: "",
                    workerAgent: "",
                  }));
                  return;
                }
                const a = account.data;
                if (!a?.user || !a.activeWorkspaceId) return;
                const w = a.workspaces.find(
                  (w) => w.id === a.activeWorkspaceId,
                );
                setDraft((d) => ({
                  ...d,
                  execution: {
                    kind: "cloud",
                    baseUrl: w?.baseUrl ?? a.baseUrl,
                    userId: w?.userId ?? a.user!.id,
                    workspaceId: a.activeWorkspaceId!,
                  },
                  coordinatorAgent: "",
                  workerAgent: "",
                }));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {cloud
                ? "Runs through your Projects worker, even when Backchat is closed."
                : "Backchat needs to stay open while agents work."}
            </p>
            <GroupedCommandField
              searchPlaceholder="Search agents…"
              emptyMessage="No agents are ready. Set up an agent in Manage agents."
              label="Coordinator agent"
              value={draft.coordinatorAgent}
              placeholder={t("project.chooseAgent")}
              onChange={(value) => field("coordinatorAgent", value)}
              options={agentFieldOptions(available)}
            />
            <GroupedCommandField
              searchPlaceholder="Search agents…"
              emptyMessage="No agents are ready. Set up an agent in Manage agents."
              label="Worker agent"
              value={draft.workerAgent}
              placeholder={t("project.chooseAgent")}
              onChange={(value) => field("workerAgent", value)}
              options={agentFieldOptions(available)}
            />
            {cloud ? (
              <>
                {(["coordinatorEnvironment", "workerEnvironment"] as const).map(
                  (key, index) => (
                    <GroupedCommandField
                      key={key}
                      searchThreshold={99}
                      label={
                        index === 0
                          ? "Coordinator environment"
                          : "Worker environment"
                      }
                      value={draft[key] ?? ""}
                      placeholder={t("project.chooseEnvironment")}
                      onChange={(value) => field(key, value)}
                      options={(catalog.data?.environments ?? [])
                        .filter((e) => e.type === "cloud")
                        .map((e) => ({ value: e.id, label: e.name }))}
                    />
                  ),
                )}
                {catalog.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {errorText(catalog.error)}
                  </p>
                ) : null}
              </>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Agents use their existing connection and permission settings.{" "}
              <Link to="/settings/agents" className="underline">
                Manage agents
              </Link>
            </p>
          </TabsContent>
        </Tabs>
      )}
    </FormDialog>
  );
}
function agentFieldOptions(
  agents: { id: string; label: string; icon?: string }[] | undefined,
) {
  return (agents ?? []).map((agent) => ({
    value: agent.id,
    label: agent.label,
    keywords: [agent.label, agent.id],
    leading: (
      <AgentIcon
        agentId={agent.id}
        iconUrl={agent.icon}
        title={agent.label}
        className="size-3.5"
      />
    ),
  }));
}

function ProjectOutcomeBar({
  goal,
  busy,
  onPause,
  onResume,
}: {
  goal: ProjectWorkView["facts"]["goals"][number];
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const { t } = useI18n();
  const presentation = projectGoalPresentation(goal);
  return (
    <section className={`project-outcome project-outcome-${presentation.tone}`} aria-label={t("project.outcome")}>
      <div className="project-outcome-copy">
        <span className="project-outcome-label">{t("project.outcomeLabel")}</span>
        <strong title={presentation.title}>{presentation.title}</strong>
        <span className="project-outcome-status">
          {projectOutcomeLabel(goal.status)}
          {presentation.budgetLabel ? ` · ${presentation.budgetLabel} tokens` : ""}
        </span>
      </div>
      <div className="project-outcome-actions">
        {presentation.actions.pause ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onPause}>
            <CirclePauseIcon className="size-3.5" />
            {t("project.pause")}
          </Button>
        ) : null}
        {presentation.actions.resume ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onResume}>
            <CirclePlayIcon className="size-3.5" />
            {t("project.resume")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ProjectWorkspace({
  view,
  refresh,
  edit,
}: {
  view: ProjectWorkView;
  refresh: () => Promise<void>;
  edit: () => void;
}) {
  const { project, config, facts } = view;
  const { t } = useI18n();
  const [tab, setTab] = useState<
    "conversation" | "workers" | "activity" | "overview"
  >("conversation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<{
    type: ProjectWorkCommand["type"];
    workerId?: string;
  } | null>(null);
  const [resource, setResource] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [runId, setRunId] = useState(() => {
    const last = facts.events.at(-1)?.payload as { runId?: string } | undefined;
    return last?.runId ?? crypto.randomUUID();
  });
  const uncertainSubmission = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);
  const sessions = facts.sessions.filter(
    (s) =>
      config?.continuity !== "per-run" ||
      s.workThreadId.includes(`:run:${runId}:`),
  );
  const coordinator = sessions.filter((s) => s.agentId === "coordinator");
  const workers = sessions.filter((s) => s.agentId === "worker");
  const selectedTurns = facts.turns.filter((t) =>
    coordinator.some((s) => s.id === t.sessionId),
  );
  const projectThreadView = projectThreads(
    view,
    config?.continuity === "per-run" ? runId : undefined,
  );
  const coordinatorOutcome = projectThreadView.find(
    (thread) => thread.role === "coordinator",
  )?.goal;
  const setCoordinatorOutcome = async (status: "active" | "paused") => {
    if (!coordinatorOutcome) return;
    setBusy(true);
    setError("");
    try {
      await window.backchat.projectWorkGoal({
        projectId: project.id,
        workThreadId: coordinatorOutcome.workThreadId,
        status,
      });
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (
    type: ProjectWorkCommand["type"],
    message: string,
    workerId?: string,
    attachments?: PromptAttachment[],
  ) => {
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify([
      type,
      message,
      workerId,
      runId,
      attachments,
    ]);
    if (uncertainSubmission.current?.fingerprint !== fingerprint)
      uncertainSubmission.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await window.backchat.projectWorkSubmit({
        projectId: project.id,
        commandId: uncertainSubmission.current!.id,
        type,
        text: message,
        attachments,
        ...(workerId ? { workerId } : {}),
        ...(config?.continuity === "per-run" ? { runId } : {}),
      });
      uncertainSubmission.current = null;
      await refresh();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const coordinatorChatTurns = projectCoordinatorTurns(
    view, config?.continuity === "per-run" ? runId : undefined,
  );
  const promptPayloads = new Map(selectedTurns.map((turn) => [
    turn.id,
    facts.events.find((event) => event.id === turn.triggerEventId)?.payload,
  ] as const));
  const runs = [
    ...new Set(
      facts.events
        .map((e) => (e.payload as { runId?: string } | undefined)?.runId)
        .filter((id): id is string => !!id),
    ),
  ];
  return (
    <>
      <PageTopbar>
        <div className="app-no-drag flex min-w-0 flex-1 items-center gap-1.5 text-ui">
          <div className="app-drag-region min-w-0 flex-1">
            <button
              type="button"
              onClick={edit}
              title={project.name}
              className="app-no-drag max-w-full truncate text-left font-medium text-fg hover:text-fg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {project.name}
            </button>
          </div>
          <Button
            variant={tab !== "conversation" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={tab !== "conversation"}
            onClick={() => {
              setSelectedWorker(null);
              setTab(tab === "conversation" ? "workers" : "conversation");
            }}
          >
            <ListTodoIcon className="size-3.5" />
            {t("project.tasks")}
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("project.edit")}
            onClick={edit}
          >
            <SettingsIcon />
          </Button>
        </div>
      </PageTopbar>
      <div
        className={`project-columns${tab !== "conversation" ? " project-panel-open" : ""}`}
      >
        <section className="project-main">
          {config?.continuity === "per-run" ? (
            <div className="project-runs">
              <select
                aria-label={t("project.selectRun")}
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              >
                {[...new Set([...runs, runId])].map((id, i) => (
                  <option key={id} value={id}>
                    Run {i + 1} · {id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                onClick={() => setRunId(crypto.randomUUID())}
              >
                <PlusIcon />
                New run
              </Button>
            </div>
          ) : null}
          {coordinatorOutcome ? (
            <ProjectOutcomeBar
              goal={coordinatorOutcome}
              busy={busy}
              onPause={() => void setCoordinatorOutcome("paused")}
              onResume={() => void setCoordinatorOutcome("active")}
            />
          ) : null}
          {!config?.coordinatorAgent || !config?.workerAgent ? (
            <div className="projects-empty">
              <h2>Make this project your own</h2>
              <p>Choose your agents and add instructions to begin.</p>
              <Button onClick={edit}>Set up coordinator</Button>
            </div>
          ) : (
            <>
              <ProjectConversation
                turns={coordinatorChatTurns}
                cwd={project.primary_folder || null}
                promptPayloads={promptPayloads}
                composer={
                  <ProjectComposer
                      key={`${project.id}:${runId}`}
                      agentId={config.coordinatorAgent}
                      sessionId={selectedTurns.at(-1)?.sessionId ?? coordinator.at(-1)?.id}
                      localAuth={config.execution?.kind !== "cloud"}
                      authRequired={facts.agentEvents.some(event => event.turn_id === selectedTurns.at(-1)?.id && event.type === "session.error" && (event.data as { code?: string }).code === "auth_required")}
                      placeholder={`Message ${project.name}…`}
                      busy={busy}
                      onSubmit={(message, attachments) =>
                        submit("message", message, undefined, attachments)
                      }
                      onEditAgents={edit}
                  />
                }
              />
            </>
          )}
          {error || view.error ? (
            <p role="alert" className="project-error">
              {error || view.error}
            </p>
          ) : null}
        </section>
        {tab !== "conversation" ? (
          <Tabs
            asChild
            value={tab}
            onValueChange={(value) => {
              if (
                value === "workers" ||
                value === "overview" ||
                value === "activity"
              ) {
                setSelectedWorker(null);
                setTab(value);
              }
            }}
          >
            <aside
              className="project-side-panel"
              aria-label={
                tab === "overview"
                  ? "Project overview"
                  : tab === "workers"
                    ? "Project workers"
                    : "Project activity"
              }
            >
              <div className="project-side-heading">
                {selectedWorker && tab === "workers" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedWorker(null)}
                  >
                    <ArrowLeftIcon />
                    {t("project.threads")}
                  </Button>
                ) : (
                  <TabsList
                    aria-label={t("project.views")}
                    className="project-panel-tabs"
                  >
                    <TabsTrigger value="workers">
                      {t("project.threads")}
                    </TabsTrigger>
                    <TabsTrigger value="overview">Library</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                  </TabsList>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("project.closePanel")}
                  onClick={() => setTab("conversation")}
                >
                  <XIcon />
                </Button>
              </div>
              <TabsContent value={tab} className="project-panel-content">
                {selectedWorker && tab === "workers" ? (
                  <ProjectWorkerDetail
                    key={`${runId}:${selectedWorker}`}
                    view={view}
                    sessionIds={workers.map((worker) => worker.id)}
                    workerId={selectedWorker}
                    busy={busy}
                    submit={(message, attachments) =>
                      submit("steer", message, selectedWorker, attachments)
                    }
                    edit={edit}
                  />
                ) : tab === "overview" ? (
                  <div
                    className="project-knowledge"
                    aria-label={t("project.knowledge")}
                  >
                    <div className="project-knowledge-heading">
                      <h2>Project knowledge</h2>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("project.editKnowledge")}
                        onClick={edit}
                      >
                        <PencilIcon />
                      </Button>
                    </div>
                    <section>
                      <h3>Instructions</h3>
                      <p>{config?.instructions || "No instructions yet."}</p>
                      {!config?.instructions ? (
                        <button onClick={edit}>Add instructions</button>
                      ) : null}
                    </section>
                    <section>
                      <h3>Context</h3>
                      {config?.description ? <p>{config.description}</p> : null}
                      <p>{config?.context || "No additional context."}</p>
                    </section>
                    <section>
                      <div className="project-knowledge-heading">
                        <h3>Resources</h3>
                        {config ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("project.addResource")}
                            onClick={() => setResource(true)}
                          >
                            <PlusIcon />
                          </Button>
                        ) : null}
                      </div>
                      {config?.resources.map((r) => (
                        <details className="project-resource" key={r.id}>
                          <summary>
                            <FileTextIcon className="size-4" />
                            {r.name}
                          </summary>
                          <p>{r.text}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void window.backchat
                                .projectWorkSave({
                                  ...config,
                                  resources: config.resources.filter(
                                    (v) => v.id !== r.id,
                                  ),
                                })
                                .then(refresh)
                                .catch((e) => setError(errorText(e)));
                            }}
                          >
                            <XIcon />
                            Remove
                          </Button>
                        </details>
                      ))}
                      {!config?.resources.length ? (
                        <p>No resources yet.</p>
                      ) : null}
                    </section>
                    <section className="project-runtime-summary">
                      <h3>Agents</h3>
                      <dl>
                        <dt>Coordinator</dt>
                        <dd>{config?.coordinatorAgent || "Not configured"}</dd>
                        <dt>Workers</dt>
                        <dd>{config?.workerAgent || "Not configured"}</dd>
                      </dl>
                    </section>
                  </div>
                ) : tab === "workers" ? (
                  <div className="project-work-list">
                    <div className="project-panel-summary">
                      <span>
                        {workers.length + (view.external_tasks?.length ?? 0)
                          ? `${workers.length + (view.external_tasks?.length ?? 0)} ${t("project.threads").toLowerCase()}`
                          : t("project.noTasks")}
                      </span>
                      {config?.controls.includes("delegate") ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("project.delegateTask")}
                          title={t("project.delegateTask")}
                          onClick={() => setAction({ type: "delegate" })}
                        >
                          <PlusIcon className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    {!workers.length && !(view.external_tasks?.length) ? (
                      <div className="project-workers-empty">
                        <h3>{t("project.tasksAppearHere")}</h3>
                        <p>{t("project.tasksEmptyHint")}</p>
                      </div>
                    ) : null}
                    {[
                      "running",
                      "queued",
                      "failed",
                      "completed",
                      "cancelled",
                      "other",
                    ].map((state) => {
                      const group = workers.filter((worker) => {
                        const status =
                          facts.turns
                            .filter((turn) => turn.sessionId === worker.id)
                            .at(-1)?.state ?? "other";
                        return status === state;
                      });
                      if (!group.length) return null;
                      const labels: Record<string, string> = {
                        running: "Working",
                        queued: "Queued",
                        failed: "Failed",
                        completed: "Completed",
                        cancelled: "Cancelled",
                        other: "No turns yet",
                      };
                      return (
                        <section key={state} className="project-worker-group">
                          <h3>
                            {labels[state]} <span>{group.length}</span>
                          </h3>
                          {group.map((s) => {
                            const workerId = s.workThreadId
                              .split(":worker:")
                              .slice(1)
                              .join(":worker:");
                            const turns = facts.turns.filter(
                              (t) => t.sessionId === s.id,
                            );
                            const last = turns.at(-1);
                            const workspace = view.workspaces?.find(
                              (w) => w.workThreadId === s.workThreadId,
                            );
                            const location = workspace?.location as
                              | {
                                  cwd?: string;
                                  branch?: string | null;
                                  remoteSessionId?: string;
                                }
                              | null
                              | undefined;
                            return (
                              <article className="project-worker" key={s.id}>
                                <div>
                                  <button
                                    className="project-worker-title"
                                    onClick={() => setSelectedWorker(workerId)}
                                  >
                                    {workerId}
                                  </button>
                                  <p className="project-worker-attribution" data-testid="task-attribution">
                                    {t("project.builtInAttribution")}
                                  </p>
                                  <p className="project-worker-preview">
                                    {projectResponseText(
                                      facts.agentEvents.filter(
                                        (e) => e.turn_id === last?.id,
                                      ),
                                    ).slice(0, 160) || "Waiting for output…"}
                                  </p>
                                  {location ? (
                                    <details>
                                      <summary>
                                        Workspace
                                        {location.branch
                                          ? ` · ${location.branch}`
                                          : ""}
                                      </summary>
                                      <p>
                                        {location.cwd ??
                                          `OpenMA session ${location.remoteSessionId}`}
                                      </p>
                                      <p>
                                        Retained for this work thread, including
                                        after completion.
                                      </p>
                                    </details>
                                  ) : null}
                                  <span>
                                    {last?.state ?? s.state} ·{" "}
                                    {config?.workerAgent}
                                  </span>
                                  {(() => {
                                    const outcome = projectThreadView.find(
                                      (thread) => thread.workThreadId === s.workThreadId,
                                    )?.goal;
                                    return outcome ? (
                                      <span className="project-worker-outcome">
                                        Outcome: {projectOutcomeLabel(outcome.status)}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                                <div className="project-worker-actions">
                                  {config?.controls.includes("steer") ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        setAction({ type: "steer", workerId })
                                      }
                                    >
                                      Steer
                                    </Button>
                                  ) : null}
                                  {config?.controls.includes("cancel") &&
                                  last &&
                                  ["queued", "running"].includes(last.state) ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        void submit(
                                          "cancel",
                                          "Cancelled by user",
                                          workerId,
                                        )
                                      }
                                    >
                                      Cancel
                                    </Button>
                                  ) : null}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setSelectedWorker(workerId)}
                                  >
                                    View thread
                                  </Button>
                                </div>
                              </article>
                            );
                          })}
                        </section>
                      );
                    })}
                    {(view.external_tasks ?? []).map((task) => (
                      <article className="project-worker" key={task.id} data-testid="external-task">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="project-worker-title min-w-0 flex-1 truncate">{task.text}</p>
                          {task.status === "cancelled" ? (
                            <span className="shrink-0 text-[11px] text-fg-subtle">Cancelled</span>
                          ) : null}
                          <ExternalSourceBadge client={task.coordinator_name} />
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="project-work-list">
                    <div className="project-section-heading">
                      <h2>Activity history</h2>
                      {config?.controls.includes("complete") ? (
                        <Button
                          variant="outline"
                          onClick={() => setAction({ type: "complete" })}
                        >
                          <CheckIcon />
                          Complete project
                        </Button>
                      ) : null}
                    </div>
                    {!facts.events.length ? (
                      <p className="project-help">
                        Activity appears when you send a message or delegate
                        work.
                      </p>
                    ) : null}
                    {[...facts.events].reverse().map((e) => {
                      const reaction = facts.reactions.find(
                        (r) => r.eventId === e.id,
                      );
                      return (
                        <details key={e.id} className="project-activity">
                          <summary>
                            <span>
                              {e.type
                                .replace("backchat.project.", "")
                                .replace("project.", "")
                                .replaceAll(".", " ")}
                            </span>
                            <span>{reaction?.status ?? "Processing"}</span>
                            <time>
                              {new Date(e.occurredAt).toLocaleTimeString()}
                            </time>
                          </summary>
                          <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                          {reaction?.reason ? <p>{reaction.reason}</p> : null}
                        </details>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </aside>
          </Tabs>
        ) : null}

        {action ? (
          <ProjectAction
            error={error}
            action={action}
            close={() => setAction(null)}
            submit={async (message, id) => {
              if (await submit(action.type, message, id)) setAction(null);
            }}
          />
        ) : null}
        {resource && config ? (
          <ResourceEditor
            close={() => setResource(false)}
            save={async (r) => {
              await window.backchat.projectWorkSave({
                ...config,
                resources: [...config.resources, r],
              });
              setResource(false);
              await refresh();
            }}
          />
        ) : null}
      </div>
    </>
  );
}
function ProjectWorkerDetail({
  view,
  sessionIds,
  workerId,
  busy,
  submit,
  edit,
}: {
  sessionIds: string[];
  view: ProjectWorkView;
  workerId: string;
  busy: boolean;
  submit: (text: string, attachments: PromptAttachment[]) => Promise<boolean>;
  edit: () => void;
}) {
  const { t } = useI18n();
  const sessions = view.facts.sessions.filter(
    (session) =>
      sessionIds.includes(session.id) &&
      session.agentId === "worker" &&
      session.workThreadId.endsWith(`:worker:${workerId}`),
  );
  const turns = view.facts.turns.filter((turn) =>
    sessions.some((session) => session.id === turn.sessionId),
  );
  return (
    <div className="project-thread-detail">
      <div className="project-thread-transcript">
        <h2>{workerId}</h2>
        {turns.map((turn) => {
          const trigger = view.facts.events.find(
            (event) => event.id === turn.triggerEventId,
          );
          const payload = trigger?.payload as
            | { text?: string; task?: string; instruction?: string }
            | undefined;
          const prompt = payload?.text ?? payload?.task ?? payload?.instruction;
          const text = projectResponseText(
            view.facts.agentEvents.filter((event) => event.turn_id === turn.id),
          );
          return (
            <article className="project-turn" key={turn.id}>
              {prompt ? (
                <div className="project-user-message">{prompt}</div>
              ) : null}
              <ProjectMessageAttachments payload={trigger?.payload} />
              <StreamdownText
                text={
                  text ||
                  (turn.state === "running" ? "Working…" : "No output yet.")
                }
                cwd={null}
                sessionId={turn.sessionId}
                surfacePrefix={`worker-${turn.id}`}
              />
              <p className="project-turn-state">{turn.state}</p>
            </article>
          );
        })}
      </div>
      {view.config?.controls.includes("steer") ? (
        <ProjectComposer
          agentId={view.config.workerAgent}
          sessionId={turns.at(-1)?.sessionId ?? sessions.at(-1)?.id}
          localAuth={view.config.execution?.kind !== "cloud"}
          authRequired={view.facts.agentEvents.some(event => event.turn_id === turns.at(-1)?.id && event.type === "session.error" && (event.data as { code?: string }).code === "auth_required")}
          role="Worker"
          label="Message worker"
          placeholder={t("project.followUpPlaceholder")}
          busy={busy}
          onSubmit={submit}
          onEditAgents={edit}
        />
      ) : null}
    </div>
  );
}

function ProjectAction({
  action,
  close,
  submit,
  error,
}: {
  error: string;
  action: { type: ProjectWorkCommand["type"]; workerId?: string };
  close: () => void;
  submit: (text: string, id?: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [workerId, setWorkerId] = useState(action.workerId ?? "");
  const [busy, setBusy] = useState(false);
  const label =
    action.type === "delegate"
      ? "Delegate"
      : action.type === "steer"
        ? "Steer"
        : "Complete";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {label}
            {action.type === "complete" ? " project" : " task"}
          </DialogTitle>
          <DialogDescription>
            {action.type === "steer"
              ? "Queue a follow-up instruction for this worker."
              : action.type === "complete"
                ? "Record a reviewed summary of this project’s work."
                : "Give this independent task a stable name and a clear brief."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="project-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void submit(text, workerId).finally(() => setBusy(false));
          }}
        >
          {action.type !== "complete" ? (
            <label>
              Worker ID
              <Input
                required
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                readOnly={!!action.workerId}
              />
            </label>
          ) : null}
          <label>
            {action.type === "complete"
              ? "Summary"
              : action.type === "steer"
                ? "Instruction"
                : "Task"}
            <Textarea
              required
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="project-error">
              {error}
            </p>
          ) : null}
          <footer>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button loading={busy} type="submit">
              {label}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function ResourceEditor({
  close,
  save,
}: {
  close: () => void;
  save: (r: ProjectWorkConfig["resources"][number]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add project resource</DialogTitle>
          <DialogDescription>
            Add a note or upload a text or Markdown file. It will be included in
            project context.
          </DialogDescription>
        </DialogHeader>
        <form
          className="project-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void save({ id: crypto.randomUUID(), name, text })
              .catch((e) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Text file
            <input
              type="file"
              accept=".txt,.md,.csv,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 200_000) {
                  setError("Choose a text file under 200 KB.");
                  return;
                }
                setName(file.name);
                void file.text().then(setText);
              }}
            />
          </label>
          <label>
            Resource name
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Content
            <Textarea
              required
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="project-error">
              {error}
            </p>
          ) : null}
          <footer>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Add resource
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
