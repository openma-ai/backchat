import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useOpenmaCatalog, useOpenmaProjectBindings, useOpenmaRunner } from "@/lib/openma-account";
import { useI18n } from "@/lib/i18n";

export function OpenMAProjects() {
  const { t } = useI18n();
  const id = useId();
  const client = useQueryClient();
  const catalog = useOpenmaCatalog();
  const bindings = useOpenmaProjectBindings();
  const { data: runner } = useOpenmaRunner();
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => window.backchat.projectsList() });
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const env = catalog.data?.environments.find((e) => e.id === environmentId);
  const managesDirectories = runner?.hosting === "backchat" && !!runner.runtimeId;
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setRetry(null);
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setRetry(() => operation); }
    finally {
      await Promise.all([client.invalidateQueries({ queryKey: ["openma-project-bindings"] }), client.invalidateQueries({ queryKey: ["openma-catalog"] })]);
      setBusy(false);
    }
  };
  const selectClass = "block h-9 w-full rounded-md border border-border bg-bg px-3";
  return <div className="space-y-3 border-t border-border pt-4">
    <h2 className="font-medium">{t("openma.projectEnvironments")}</h2>
    <p className="text-xs text-fg-muted">{t("openma.projectDescription")}</p>
    <div className="space-y-2"><label htmlFor={`${id}-project`}>{t("openma.project")}</label>
      <select id={`${id}-project`} className={selectClass} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy}>
        <option value="" disabled>{t("openma.chooseProject")}</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div>
    <div className="space-y-2"><label htmlFor={`${id}-environment`}>{t("openma.environment")}</label>
      <select id={`${id}-environment`} className={selectClass} value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)} disabled={busy}>
        <option value="" disabled>{t("openma.chooseEnvironment")}</option>
        {catalog.data?.environments.filter((e) => e.type === "cloud" || !e.runtimeId || e.runtimeId === runner?.runtimeId).map((e) => <option key={e.id} value={e.id} disabled={e.type === "self_hosted" && !managesDirectories}>{e.name} · {t(e.type === "cloud" ? "chat.cloud" : "chat.local")}</option>)}
      </select>
    </div>
    <div className="flex gap-2">
      <Button disabled={busy || !projectId || !env || (env.type === "self_hosted" && !managesDirectories)} onClick={() => void run(() => window.backchat.openmaLinkProject({ projectId, environmentId, runtimeId: env?.type === "self_hosted" ? runner!.runtimeId : null }))}>{t("openma.linkEnvironment")}</Button>
      <Button variant="outline" onClick={() => void run(() => window.backchat.openmaOpenManagement())}>{t("openma.manageResources")}</Button>
    </div>
    {runner?.hosting === "external" && <p className="text-xs text-fg-muted">{t("openma.externalProjectDirectories")}</p>}
    {bindings.data?.map((binding) => <div key={`${binding.environmentId}/${binding.runtimeId}`} className="flex items-center justify-between gap-2 text-xs">
      <span>{projects.find((p) => p.id === binding.projectId)?.name ?? binding.projectId} → {catalog.data?.environments.find((e) => e.id === binding.environmentId)?.name ?? binding.environmentId}</span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => window.backchat.openmaUnlinkProject(binding))}>{t("openma.unlinkEnvironment")}</Button>
    </div>)}
    {(error || catalog.error || bindings.error) && <p role="alert" className="text-red-500">{error || catalog.error?.message || bindings.error?.message}</p>}
    {retry && <Button variant="outline" disabled={busy} onClick={() => void run(retry)}>{t("common.retry")}</Button>}
  </div>;
}
