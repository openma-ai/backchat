import { PageScaffold } from "@/components/shell/PageScaffold";
import { ArrowLeftIcon } from "@/components/Icons";
import { SettingsCard, SettingsField, SettingsSection } from "./SettingsPrimitives";
import { ProjectIcon } from "@/components/ProjectIcon";
import { useState } from "react";
import { Link, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectIcon, saveProjectIcon } from "@/components/ProjectGlyph";
import { ProjectIconPicker } from "@/components/ProjectIconPicker";
import { ProjectFolderList } from "@/components/shell/CreateProjectDialog";
import { ProjectEditor } from "@/pages/Projects";
import { useI18n } from "@/lib/i18n";
import type { ProjectInfo } from "@shared/projects";
import type { ProjectWorkView } from "@shared/project-work";

export function ProjectSettingsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const query = useQuery({ queryKey: ["project-work", projectId], queryFn: () => window.backchat.projectWorkView(projectId) });
  const { t } = useI18n();
  if (query.isPending) return <p role="status" className="p-6">{t("common.loadingShort")}</p>;
  if (query.error || !query.data) return <p role="alert" className="p-6">{String(query.error)}</p>;
  return <ProjectSettingsForm key={`${projectId}:${query.data.project.updated_at}`} project={query.data.project} view={query.data} />;
}
function ProjectSettingsForm({ project, view }: { project: ProjectInfo; view: ProjectWorkView }) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const key = `project:${project.id}`;
  const icon = useProjectIcon(key);
  const [name, setName] = useState(project.name);
  const [folders, setFolders] = useState(project.source_folders);
  const [picker, setPicker] = useState(false);
  const [coordinator, setCoordinator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => { await Promise.all([cache.invalidateQueries({ queryKey: ["projects"] }), cache.invalidateQueries({ queryKey: ["project-work", project.id] })]); };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await window.backchat.projectSave({ project_id: project.id, name: name.trim(), source_folders: folders, primary_folder: folders[0] ?? "" });
      await refresh(); toast.success(t("project.settingsSaved"));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <PageScaffold
    title={t("project.settings")}
    meta={<Link to="/projects/$projectId" params={{ projectId: project.id }} className="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs text-fg-muted hover:text-fg"><ArrowLeftIcon className="size-3.5 shrink-0" /><span className="truncate">{project.name}</span></Link>}
    actions={<Button type="submit" form="project-settings-form" size="sm" disabled={busy || !name.trim()}>{t("common.save")}</Button>}
  >
    <form id="project-settings-form" onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-6">
      <SettingsSection title={t("project.settingsGeneral")}>
        <SettingsCard>
          <div className="flex items-end gap-3">
            <button type="button" aria-label={t("project.iconTitle")} title={t("project.iconTitle")} onClick={() => setPicker(true)} className="flex size-8 shrink-0 items-center justify-center rounded-md p-1.5 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring"><ProjectIcon identity={key} sourceFolders={project.source_folders} primaryRoot={project.primary_folder} className="size-full" /></button>
            <div className="min-w-0 flex-1"><SettingsField label={t("project.settingsName")}><Input className="h-8 text-xs" required value={name} onChange={e => setName(e.target.value)} /></SettingsField></div>
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("project.settingsFolders")}>
        <ProjectFolderList folders={folders}
          onAdd={() => void window.backchat.uiFsPickDirs().then(paths => setFolders(current => [...new Set([...current, ...paths])])).catch(e => setError(String(e)))}
          onMakePrimary={folder => setFolders(current => [folder, ...current.filter(p => p !== folder)])}
          onRemove={folder => setFolders(current => current.filter(p => p !== folder))} />
      </SettingsSection>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </form>
    <SettingsSection title={t("project.settingsExecution")}>
      <SettingsCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs leading-5 text-fg-muted">{t("project.settingsExecutionHint")}</p>
          <Button size="sm" variant="outline" onClick={() => setCoordinator(true)}>{t("project.settingsConfigure")}</Button>
        </div>
      </SettingsCard>
    </SettingsSection>
    {picker && <ProjectIconPicker identity={key} initial={icon} open={picker} onOpenChange={setPicker} onSave={choice => { saveProjectIcon(key, choice); setPicker(false); }} />}
    {coordinator && <ProjectEditor project={project} config={view.config ?? undefined} close={() => setCoordinator(false)} saved={async () => { setCoordinator(false); await refresh(); }} removed={async () => { setCoordinator(false); await cache.invalidateQueries({ queryKey: ["projects"] }); await navigate({ to: "/settings/activity" }); }} />}
  </PageScaffold>;
}
